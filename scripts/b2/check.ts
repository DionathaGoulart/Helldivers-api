import { AwsClient } from "aws4fetch";
import { z } from "zod";

export const B2CheckEnv = z.object({
  B2_S3_ENDPOINT: z.url({ protocol: /^https$/ }),
  B2_BUCKET: z.string().min(1),
  B2_WRITE_KEY_ID: z.string().min(1),
  B2_WRITE_APP_KEY: z.string().min(1),
  B2_READ_KEY_ID: z.string().min(1),
  B2_READ_APP_KEY: z.string().min(1),
});
export type B2CheckEnv = z.infer<typeof B2CheckEnv>;

export const B2ReadEnv = B2CheckEnv.pick({
  B2_S3_ENDPOINT: true,
  B2_BUCKET: true,
  B2_READ_KEY_ID: true,
  B2_READ_APP_KEY: true,
});
export type B2ReadEnv = z.infer<typeof B2ReadEnv>;

export interface B2CheckDeps {
  fetch: (request: Request) => Promise<Response>;
  now: () => number;
  log: (line: string) => void;
}

export class B2CheckError extends Error {
  readonly step: string;
  readonly status: number;

  constructor(step: string, status: number, hint: string) {
    super(`${step} failed: HTTP ${status} — ${hint}`);
    this.name = "B2CheckError";
    this.step = step;
    this.status = status;
  }
}

// Smallest valid WebP (1×1 lossless). B2 stores the bytes as-is.
const TEST_WEBP = Uint8Array.from(
  Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"),
);

export function regionFromEndpoint(endpoint: string): string {
  const match = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).hostname);
  if (!match?.[1]) {
    throw new Error(`cannot read the B2 region from ${endpoint}`);
  }
  return match[1];
}

/**
 * Upload with the write key, signed GET with the read key, unsigned GET (must be
 * refused), then delete. The test object is deleted even when a middle step fails.
 */
export async function runB2Check(env: B2CheckEnv, deps: B2CheckDeps): Promise<void> {
  const region = regionFromEndpoint(env.B2_S3_ENDPOINT);
  const writer = new AwsClient({
    accessKeyId: env.B2_WRITE_KEY_ID,
    secretAccessKey: env.B2_WRITE_APP_KEY,
    service: "s3",
    region,
  });
  const reader = new AwsClient({
    accessKeyId: env.B2_READ_KEY_ID,
    secretAccessKey: env.B2_READ_APP_KEY,
    service: "s3",
    region,
  });
  // Path-style URL keeps the bucket name's case (arch §2).
  const key = `_b2-check/${deps.now()}.webp`;
  const url = `${env.B2_S3_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(env.B2_BUCKET)}/${key}`;

  const uploaded = await deps.fetch(
    await writer.sign(url, {
      method: "PUT",
      body: TEST_WEBP,
      headers: { "content-type": "image/webp" },
    }),
  );
  expectStatus(uploaded, "upload", [200], "check the write key and its access to the bucket");
  const results = ["upload ok"];

  let failure: unknown;
  try {
    const signed = await deps.fetch(await reader.sign(url, { method: "GET" }));
    expectStatus(signed, "signed get", [200], "check the read key and its access to the bucket");
    const size = (await signed.arrayBuffer()).byteLength;
    if (size !== TEST_WEBP.byteLength) {
      throw new Error(`signed get failed: expected ${TEST_WEBP.byteLength} bytes, got ${size}`);
    }
    results.push("signed get 200");

    const unsigned = await deps.fetch(new Request(url));
    expectStatus(unsigned, "unsigned get", [401, 403], "the bucket must stay private");
    results.push(`unsigned ${unsigned.status}`);
  } catch (error) {
    failure = error;
  }

  const deleted = await deps.fetch(await writer.sign(url, { method: "DELETE" }));
  if (failure !== undefined) {
    if (!isStatus(deleted, [200, 204])) {
      deps.log(`cleanup failed: HTTP ${deleted.status} — delete ${key} by hand`);
    }
    throw failure;
  }
  expectStatus(deleted, "delete", [200, 204], `delete ${key} by hand; the write key must delete`);
  results.push("delete ok");

  deps.log(results.join(" · "));
}

/**
 * Signed GET of one published image with the read key, as the `/images/*` Function does:
 * `images/v1/<collection>/<id>.<hash8>.webp`, or the `/images/…` URL from an entity.
 */
export async function runB2KeyCheck(
  env: B2ReadEnv,
  key: string,
  deps: Omit<B2CheckDeps, "now">,
): Promise<void> {
  const objectKey = key.replace(/^\//, "");
  if (!/^images\/v1\/[a-z-]+\/[a-z0-9-]+\.[a-f0-9]{8}\.webp$/.test(objectKey)) {
    throw new Error(`not an image key: ${key}`);
  }
  const reader = new AwsClient({
    accessKeyId: env.B2_READ_KEY_ID,
    secretAccessKey: env.B2_READ_APP_KEY,
    service: "s3",
    region: regionFromEndpoint(env.B2_S3_ENDPOINT),
  });
  const url = `${env.B2_S3_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(env.B2_BUCKET)}/${objectKey}`;
  const response = await deps.fetch(await reader.sign(url, { method: "GET" }));
  expectStatus(response, "signed get", [200], `check that ${objectKey} was uploaded`);
  const size = (await response.arrayBuffer()).byteLength;
  deps.log(`signed get 200 · ${response.headers.get("content-type")} · ${size} bytes`);
}

function isStatus(response: Response, allowed: readonly number[]): boolean {
  return allowed.includes(response.status);
}

function expectStatus(
  response: Response,
  step: string,
  allowed: readonly number[],
  hint: string,
): void {
  if (!isStatus(response, allowed)) {
    throw new B2CheckError(step, response.status, hint);
  }
}
