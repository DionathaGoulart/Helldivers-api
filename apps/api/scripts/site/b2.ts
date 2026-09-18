import { AwsClient } from "aws4fetch";
import { z } from "zod";

// Signed reads from the private Backblaze B2 bucket (arch §8.1, ADR-006), for `pnpm images:pull`.

export const B2ReadEnv = z.object({
  B2_S3_ENDPOINT: z.url({ protocol: /^https$/ }),
  B2_BUCKET: z.string().min(1),
  B2_READ_KEY_ID: z.string().min(1),
  B2_READ_APP_KEY: z.string().min(1),
});
export type B2ReadEnv = z.infer<typeof B2ReadEnv>;

export function regionFromEndpoint(endpoint: string): string {
  const match = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).hostname);
  if (!match?.[1]) {
    throw new Error(`cannot read the B2 region from ${endpoint}`);
  }
  return match[1];
}

export class B2Reader {
  readonly #client: AwsClient;
  readonly #bucketUrl: string;

  constructor(
    env: B2ReadEnv,
    readonly fetch: (request: Request) => Promise<Response>,
  ) {
    this.#client = new AwsClient({
      accessKeyId: env.B2_READ_KEY_ID,
      secretAccessKey: env.B2_READ_APP_KEY,
      service: "s3",
      region: regionFromEndpoint(env.B2_S3_ENDPOINT),
    });
    // Path-style URL keeps the bucket name's case (arch §2).
    this.#bucketUrl = `${env.B2_S3_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(env.B2_BUCKET)}`;
  }

  /** `key` = the image url without its leading slash (`images/v1/…`). */
  async get(key: string): Promise<Response> {
    const request = await this.#client.sign(`${this.#bucketUrl}/${key}`, { method: "GET" });
    return this.fetch(request);
  }
}
