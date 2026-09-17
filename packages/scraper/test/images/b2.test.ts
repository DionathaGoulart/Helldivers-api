import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { B2Error, B2Store, IMAGE_CACHE_CONTROL } from "../../src/images/b2.ts";

describe("B2Store", () => {
  const options = {
    endpoint: "https://s3.us-east-005.backblazeb2.com",
    bucket: "Helldivers-api",
    keyId: "write-id",
    appKey: "write-secret",
    retryDelaysMs: [1, 2, 3],
    sleep: async () => undefined,
  };

  function fakeS3(statuses: (number | Error)[]) {
    const requests: Request[] = [];
    const fetch = async (request: Request) => {
      requests.push(request);
      const next = statuses.shift();
      if (next === undefined) throw new Error(`unexpected ${request.method} ${request.url}`);
      if (next instanceof Error) throw next;
      return new Response(null, { status: next });
    };
    return { fetch, requests };
  }

  it("uploads with a signed path-style PUT, the payload hash and immutable caching", async () => {
    const s3 = fakeS3([200]);
    const store = new B2Store({ ...options, fetch: s3.fetch });
    const body = new Uint8Array([82, 73, 70, 70]);
    await store.put("images/v1/weapons/ar-23-liberator.0d15ea5e.webp", body);

    const [request] = s3.requests;
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(
      "https://s3.us-east-005.backblazeb2.com/Helldivers-api/images/v1/weapons/ar-23-liberator.0d15ea5e.webp",
    );
    expect(request?.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=write-id\/\d{8}\/us-east-005\/s3\/aws4_request/,
    );
    expect(request?.headers.get("content-type")).toBe("image/webp");
    expect(request?.headers.get("cache-control")).toBe(IMAGE_CACHE_CONTROL);
    expect(request?.headers.get("x-amz-content-sha256")).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect([...new Uint8Array((await request?.arrayBuffer()) ?? new ArrayBuffer(0))]).toEqual([
      82, 73, 70, 70,
    ]);
  });

  it("tells existing keys apart with HEAD", async () => {
    const s3 = fakeS3([200, 404, 403]);
    const store = new B2Store({ ...options, fetch: s3.fetch });
    expect(await store.exists("images/v1/a.0d15ea5e.webp")).toBe(true);
    expect(await store.exists("images/v1/b.0d15ea5e.webp")).toBe(false);
    expect(await store.exists("images/v1/c.0d15ea5e.webp")).toBe(false); // no read access
    expect(s3.requests.map((request) => request.method)).toEqual(["HEAD", "HEAD", "HEAD"]);
  });

  it("retries network errors, 5xx and 429, signing each attempt", async () => {
    const s3 = fakeS3([new Error("socket hang up"), 503, 429, 200]);
    const store = new B2Store({ ...options, fetch: s3.fetch });
    await store.put("images/v1/a.0d15ea5e.webp", new Uint8Array([1]));
    expect(s3.requests).toHaveLength(4);
  });

  it("gives up after three retries and does not retry other errors", async () => {
    const busy = fakeS3([503, 503, 503, 503]);
    await expect(
      new B2Store({ ...options, fetch: busy.fetch }).put("images/v1/a.webp", new Uint8Array([1])),
    ).rejects.toThrow(new B2Error("PUT", "images/v1/a.webp", 503));
    expect(busy.requests).toHaveLength(4);

    const denied = fakeS3([401]);
    await expect(
      new B2Store({ ...options, fetch: denied.fetch }).put("images/v1/a.webp", new Uint8Array([1])),
    ).rejects.toThrow("B2 PUT images/v1/a.webp failed: HTTP 401");
    expect(denied.requests).toHaveLength(1);
  });

  it("deletes idempotently", async () => {
    const s3 = fakeS3([204, 404]);
    const store = new B2Store({ ...options, fetch: s3.fetch });
    await store.delete("images/v1/a.0d15ea5e.webp");
    await store.delete("images/v1/a.0d15ea5e.webp");
    expect(s3.requests.map((request) => request.method)).toEqual(["DELETE", "DELETE"]);
  });
});
