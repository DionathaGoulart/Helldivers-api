import { describe, expect, it, vi } from "vitest";
import { harness, readBody } from "./helpers.ts";

const B2_ENV = {
  B2_S3_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
  B2_BUCKET: "Helldivers-api",
  B2_READ_KEY_ID: "005readkeyid",
  B2_READ_APP_KEY: "K005readappkey",
};
const IMAGE = "/images/v1/weapons/ar-23-liberator.932ff63d.webp";
const WEBP = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

async function imageHarness(upstream: () => Promise<Response> | Response, env: object = B2_ENV) {
  const fetch = vi.fn(async (_request: Request) => upstream());
  const h = await harness({ fetch }, env);
  return { ...h, fetch };
}

describe("GET /images/*", () => {
  it("signs a GET for the bucket key with the read key and streams the image", async () => {
    const h = await imageHarness(
      () =>
        new Response(WEBP, {
          status: 200,
          headers: { "Content-Length": "8", "x-amz-request-id": "abc" },
        }),
    );
    const response = await h.get(IMAGE);

    expect(h.fetch).toHaveBeenCalledTimes(1);
    const signed = h.fetch.mock.calls[0]?.[0] as Request;
    expect(signed.method).toBe("GET");
    expect(signed.url).toBe(
      `https://s3.us-east-005.backblazeb2.com/Helldivers-api${IMAGE.replace("/images", "images").replace(/^/, "/")}`,
    );
    expect(signed.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=005readkeyid\/\d{8}\/us-east-005\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[a-f0-9]{64}$/,
    );
    expect(signed.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(signed.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "image/webp",
      "content-length": "8",
      "cache-control": "public, max-age=31536000, immutable",
      etag: '"932ff63d"',
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "ETag, X-Data-Version",
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(WEBP);

    await h.ctx.settle();
    expect(h.cache.puts).toEqual([`https://helldivers-api.pages.dev${IMAGE}`]);
  });

  it("serves the cached copy without contacting B2", async () => {
    const h = await imageHarness(() => new Response(WEBP));
    h.cache.entries.set(`https://helldivers-api.pages.dev${IMAGE}`, new Response("cached"));
    const response = await h.get(`${IMAGE}?ignored=1`);
    expect(await response.text()).toBe("cached");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("answers If-None-Match with 304 without contacting B2 or the cache", async () => {
    const h = await imageHarness(() => new Response(WEBP));
    const response = await h.get(IMAGE, { "If-None-Match": 'W/"932ff63d"' });
    expect(response.status).toBe(304);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/images/foo",
    "/images/v1/weapons/ar-23-liberator.webp",
    "/images/v1/weapons/AR-23.932ff63d.webp",
    "/images/v1/enemies/charger.932ff63d.webp",
    "/images/v1/weapons/ar-23-liberator.932ff63d.png",
    "/images/v1/weapons/../meta.932ff63d.webp",
  ])("refuses %s with 404 and no B2 call", async (path) => {
    const h = await imageHarness(() => new Response(WEBP));
    const response = await h.get(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("maps a missing object to 404 and other B2 answers to 502, never cached", async () => {
    const missing = await imageHarness(() => new Response("NoSuchKey", { status: 404 }));
    const notFound = await missing.get(IMAGE);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("cache-control")).toBe("no-store");

    const refused = await imageHarness(() => new Response("AccessDenied", { status: 403 }));
    const badGateway = await refused.get(IMAGE);
    expect(badGateway.status).toBe(502);
    expect((await readBody(badGateway)).detail).toBe("The image backend answered HTTP 403.");
    expect(refused.logs[0]).toContain('"status":403');

    const offline = await imageHarness(() => Promise.reject(new TypeError("network down")));
    expect((await offline.get(IMAGE)).status).toBe(502);

    for (const h of [missing, refused, offline]) {
      await h.ctx.settle();
      expect(h.cache.puts).toEqual([]);
    }
  });

  it("returns 503 when the deployment has no B2 settings, while other routes still work", async () => {
    const h = await imageHarness(() => new Response(WEBP), {});
    const response = await h.get(IMAGE);
    expect(response.status).toBe(503);
    expect((await readBody(response)).type).toMatch(/#images-unavailable$/);
    expect(h.fetch).not.toHaveBeenCalled();
    expect((await h.get("/v1/query/boosters")).status).toBe(200);
  });
});
