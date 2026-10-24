import { describe, expect, it } from "vitest";
import { harness, MemoryCache, syntheticSite } from "./helpers.ts";

describe("dynamic response versions", () => {
  it("invalidates edge cache and conditional requests on code-only deploys", async () => {
    const { site } = await syntheticSite();
    const cache = new MemoryCache();
    const old = await harness({
      build: { ...site.build, responseVersion: "old-code" },
      cache: () => cache,
    });
    const path = "/v1/query/boosters";
    const before = await old.get(path);
    await old.ctx.settle();
    const etag = before.headers.get("etag") as string;
    const next = await harness({
      build: { ...site.build, responseVersion: "new-code" },
      cache: () => cache,
    });
    const after = await next.get(path, { "If-None-Match": etag });
    await next.ctx.settle();
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect(after.headers.get("x-data-version")).toBe(site.build.dataVersion);
    expect(cache.puts).toHaveLength(2);
    expect(new Set(cache.puts).size).toBe(2);
    expect(
      (await next.get(path, { "If-None-Match": after.headers.get("etag") as string })).status,
    ).toBe(304);
  });
});
