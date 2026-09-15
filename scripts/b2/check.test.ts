import { describe, expect, it } from "vitest";
import { type B2CheckEnv, B2CheckError, regionFromEndpoint, runB2Check } from "./check.ts";

const env: B2CheckEnv = {
  B2_S3_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
  B2_BUCKET: "Helldivers-api",
  B2_WRITE_KEY_ID: "write-id",
  B2_WRITE_APP_KEY: "write-secret",
  B2_READ_KEY_ID: "read-id",
  B2_READ_APP_KEY: "read-secret",
};

interface FakeB2Options {
  signedGetStatus?: number;
}

/** In-memory S3 stand-in that tells callers apart by the signing key id. */
function fakeB2(options: FakeB2Options = {}) {
  const calls: string[] = [];
  const urls: URL[] = [];
  let stored: ArrayBuffer | undefined;

  async function fetch(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const caller = authorization.includes("read-id")
      ? "read"
      : authorization.includes("write-id")
        ? "write"
        : "anonymous";
    calls.push(`${request.method} ${caller}`);
    urls.push(new URL(request.url));

    if (request.method === "PUT") {
      stored = await request.arrayBuffer();
      return new Response(null, { status: 200 });
    }
    if (request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (caller === "anonymous") {
      return new Response(null, { status: 403 });
    }
    const status = options.signedGetStatus ?? 200;
    return new Response(status === 200 ? (stored ?? null) : null, { status });
  }

  return { fetch, calls, urls };
}

describe("runB2Check", () => {
  it("uploads, reads signed, is refused unsigned and deletes", async () => {
    const b2 = fakeB2();
    const lines: string[] = [];

    await runB2Check(env, { fetch: b2.fetch, now: () => 1, log: (line) => lines.push(line) });

    expect(lines).toEqual(["upload ok · signed get 200 · unsigned 403 · delete ok"]);
    expect(b2.calls).toEqual(["PUT write", "GET read", "GET anonymous", "DELETE write"]);
    expect(b2.urls[0]?.pathname).toBe("/Helldivers-api/_b2-check/1.webp");
  });

  it("still deletes the test object when the signed read fails", async () => {
    const b2 = fakeB2({ signedGetStatus: 403 });

    const run = runB2Check(env, { fetch: b2.fetch, now: () => 1, log: () => {} });

    await expect(run).rejects.toBeInstanceOf(B2CheckError);
    await expect(run).rejects.toMatchObject({ step: "signed get", status: 403 });
    expect(b2.calls).toEqual(["PUT write", "GET read", "DELETE write"]);
  });
});

describe("regionFromEndpoint", () => {
  it("reads the region from a B2 S3 endpoint", () => {
    expect(regionFromEndpoint("https://s3.us-east-005.backblazeb2.com")).toBe("us-east-005");
  });

  it("rejects hosts that are not B2", () => {
    expect(() => regionFromEndpoint("https://example.com")).toThrow(/cannot read the B2 region/);
  });
});
