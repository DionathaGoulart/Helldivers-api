import { Problem, QueryList, Warbond, Weapon } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { dynamicETag } from "../src/lib/etag.ts";
import { harness, readBody } from "./helpers.ts";

const ids = (body: { data: { id: string }[] }) => body.data.map((item) => item.id);

describe("GET /v1/query/<collection>", () => {
  it("combines filters with AND and comma values with OR", async () => {
    const h = await harness();
    const response = await h.get(
      "/v1/query/weapons?category=primary,civilian&trait=light-armor-penetrating",
    );
    expect(response.status).toBe(200);
    const body = QueryList(Weapon).parse(await readBody(response));
    expect(ids(body)).toEqual(["ar-23-liberator", "sg-88-break-action-shotgun"]);
    expect(body.meta).toMatchObject({
      apiVersion: "v1",
      dataVersion: h.site.build.dataVersion,
      count: 2,
      total: 2,
      page: 1,
      limit: 50,
      filters: { category: ["civilian", "primary"], trait: ["light-armor-penetrating"] },
      sort: "id",
      fields: null,
    });
  });

  it("matches warbond and source through every pattern variant", async () => {
    const h = await harness();
    const byWarbond = await readBody(await h.get("/v1/query/patterns?warbond=castellans-creed"));
    expect(ids(byWarbond)).toEqual(["castellans-green"]);
    const byTarget = await readBody(
      await h.get("/v1/query/patterns?target=weapon&source=requisition"),
    );
    expect(ids(byTarget)).toEqual(["arctic"]);
  });

  it("filters booleans", async () => {
    const h = await harness();
    const poses = await readBody(await h.get("/v1/query/emotes?victoryPose=true&emote=false"));
    expect(ids(poses)).toEqual(["clapping"]);
    const noCape = await readBody(await h.get("/v1/query/armor-sets?hasCape=false"));
    expect(noCape.meta.total).toBe(0);
  });

  it("finds names and aliases without case or diacritics", async () => {
    const h = await harness();
    const body = await readBody(
      await h.get(`/v1/query/warbonds?q=${encodeURIComponent("CASTELLÁN’S")}`),
    );
    expect(ids(body)).toEqual(["castellans-creed"]);
    expect(body.meta.filters).toEqual({ q: "CASTELLÁN’S" });
    const alias = await readBody(await h.get("/v1/query/stratagems?q=ops"));
    expect(ids(alias)).toEqual(["orbital-precision-strike"]);
  });

  it("pages with links that keep the filters", async () => {
    const h = await harness();
    const first = await readBody(await h.get("/v1/query/weapons?source=warbond&limit=2"));
    expect(ids(first)).toEqual(["g-40-k-melta-mine", "p-40-k-bolt-pistol"]);
    expect(first.links).toEqual({
      self: "/v1/query/weapons?source=warbond&limit=2",
      next: "/v1/query/weapons?source=warbond&page=2&limit=2",
      prev: null,
    });
    const second = await readBody(await h.get(first.links.next));
    expect(ids(second)).toEqual(["r-40-k-hot-shot-marksman-rifle"]);
    expect(second.links).toMatchObject({
      next: null,
      prev: "/v1/query/weapons?source=warbond&limit=2",
    });
    const beyond = await readBody(await h.get("/v1/query/weapons?page=9"));
    expect(beyond.data).toEqual([]);
    expect(beyond.meta).toMatchObject({ count: 0, total: 5, page: 9 });
  });

  it("sorts by name and release date, ties by id", async () => {
    const h = await harness();
    const byName = await readBody(await h.get("/v1/query/weapons?sort=-name&fields=name"));
    expect(byName.data.map((item: { name: string }) => item.name)).toEqual([
      "SG-88 Break-Action Shotgun",
      "R/40-K Hot-Shot Marksman Rifle",
      "P/40-K Bolt Pistol",
      "G/40-K Melta Mine",
      "AR-23 Liberator",
    ]);
    const byRelease = await readBody(await h.get("/v1/query/warbonds?sort=releaseDate"));
    expect(ids(byRelease)).toEqual(["helldivers-mobilize", "viper-commandos", "castellans-creed"]);
    Warbond.array().parse(byRelease.data);
  });

  it("returns only the requested top-level fields, in schema order, always with id", async () => {
    const h = await harness();
    const body = await readBody(await h.get("/v1/query/boosters?fields=effect,name"));
    expect(Object.keys(body.data[0] ?? {})).toEqual(["id", "name", "effect"]);
    expect(body.meta.fields).toEqual(["id", "name", "effect"]);
  });

  it.each([
    [
      "/v1/query/weapons?category=primray",
      400,
      "invalid-filter-value",
      "Unknown value 'primray' for 'category'. Allowed: primary, secondary, throwable, civilian.",
    ],
    [
      "/v1/query/weapons?warbond=castellans-creeed",
      400,
      "invalid-filter-value",
      "Unknown value 'castellans-creeed' for 'warbond'. Allowed: ids listed in /v1/warbonds.json.",
    ],
    [
      "/v1/query/weapons?category=primary,",
      400,
      "invalid-filter-value",
      "Empty value in 'category'.",
    ],
    [
      "/v1/query/armor-sets?hasCape=yes",
      400,
      "invalid-filter-value",
      "Invalid value 'yes' for 'hasCape'. Allowed: true, false.",
    ],
    [
      "/v1/query/boosters?weight=light",
      400,
      "unknown-parameter",
      "Unknown parameter 'weight' for /v1/query/boosters. Allowed: warbond, source, q, sort, fields, page, limit.",
    ],
    ["/v1/query/weapons?page=0", 400, "invalid-parameter", "'page' must be an integer from 1."],
    [
      "/v1/query/weapons?limit=101",
      400,
      "invalid-parameter",
      "'limit' must be an integer from 1 to 100.",
    ],
    ["/v1/query/weapons?page=1&page=2", 400, "invalid-parameter", "'page' can be given only once."],
    [
      "/v1/query/boosters?sort=releaseDate",
      400,
      "invalid-parameter",
      "Unknown value 'releaseDate' for 'sort'. Allowed: id, -id, name, -name.",
    ],
    [
      "/v1/query/weapons?q=%20a%20",
      400,
      "invalid-parameter",
      "'q' needs at least 2 letters or digits.",
    ],
    [
      "/v1/query/passives?fields=weight",
      400,
      "invalid-parameter",
      "Unknown field 'weight' for 'fields'. Allowed: id, slug, name, aliases, description, image, wiki, effects, armorIds.",
    ],
    [
      "/v1/query/enemies",
      404,
      "not-found",
      expect.stringContaining("Unknown collection 'enemies'"),
    ],
  ])("%s → %i %s", async (path, status, type, detail) => {
    const h = await harness();
    const response = await h.get(path);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = Problem.parse(await readBody(response));
    expect(body).toMatchObject({
      type: `https://helldivers-api.dionatha.com.br/docs/errors#${type}`,
      status,
      detail,
      instance: path,
    });
    expect(h.assets.requests).toEqual([]);
    expect(h.cache.puts).toEqual([]);
  });

  it("sets dynamic caching, CORS and a weak ETag from the canonical URL", async () => {
    const h = await harness();
    const response = await h.get(
      "/v1/query/weapons?trait=light-armor-penetrating&category=primary,civilian",
    );
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=86400",
      "access-control-allow-origin": "*",
      "access-control-expose-headers":
        "ETag, X-Data-Version, X-API-Tier, RateLimit-Policy, RateLimit, Retry-After",
      "x-data-version": h.site.build.dataVersion,
      "x-content-type-options": "nosniff",
      etag: dynamicETag(
        h.site.build.dataVersion,
        "/v1/query/weapons?category=civilian,primary&trait=light-armor-penetrating",
      ),
    });
    // Same filters in another order and with explicit defaults: same ETag.
    const same = await h.get(
      "/v1/query/weapons?category=civilian,primary&page=1&limit=50&trait=light-armor-penetrating",
    );
    expect(same.headers.get("etag")).toBe(response.headers.get("etag"));
  });

  it("answers If-None-Match with 304 before loading any data", async () => {
    const h = await harness();
    const etag = dynamicETag(h.site.build.dataVersion, "/v1/query/weapons?category=primary");
    const response = await h.get("/v1/query/weapons?category=primary", {
      "If-None-Match": `"x", ${etag}`,
    });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("");
    expect(h.assets.requests).toEqual([]);
  });

  it("caches under a key that carries the dataVersion and serves the cached copy", async () => {
    const h = await harness();
    const path = "/v1/query/boosters?source=warbond";
    await h.get(path);
    await h.ctx.settle();
    const key = `https://helldivers-api.dionatha.com.br${path}&_dv=${h.site.build.dataVersion}`;
    expect(h.cache.puts).toEqual([key]);

    h.cache.entries.set(key, new Response('{"cached":true}', { status: 200 }));
    const cached = await h.get(path);
    expect(await readBody(cached)).toEqual({ cached: true });

    await h.get("/v1/query/boosters");
    await h.ctx.settle();
    expect(h.cache.puts[1]).toBe(
      `https://helldivers-api.dionatha.com.br/v1/query/boosters?_dv=${h.site.build.dataVersion}`,
    );
  });

  it("loads a collection once per isolate", async () => {
    const h = await harness();
    await h.get("/v1/query/weapons?category=primary");
    await h.get("/v1/query/weapons?category=secondary");
    expect(h.assets.requests).toEqual(["/v1/weapons.json"]);
  });

  it("turns an asset failure into a 500 problem and retries on the next request", async () => {
    const h = await harness();
    h.assets.status = 500;
    const failed = await h.get("/v1/query/weapons");
    expect(failed.status).toBe(500);
    const body = await readBody(failed);
    expect(body).toMatchObject({
      title: "Internal error",
      detail: "Unexpected error. Try again later.",
    });
    expect(JSON.stringify(body)).not.toContain("asset");
    expect(h.logs[0]).toContain('"level":"error"');
    expect(h.cache.puts).toEqual([]);

    h.assets.status = 200;
    expect((await h.get("/v1/query/weapons")).status).toBe(200);
  });

  it("answers HEAD without a body, preflights and refuses other methods", async () => {
    const h = await harness();
    const head = await h.get("/v1/query/weapons", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const preflight = await h.get(
      "/v1/query/weapons",
      { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "if-none-match" },
      "OPTIONS",
    );
    expect(preflight.status).toBe(204);
    expect(Object.fromEntries(preflight.headers)).toMatchObject({
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "if-none-match",
    });

    const post = await h.get("/v1/query/weapons", {}, "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    expect((await readBody(post)).type).toMatch(/#method-not-allowed$/);
  });

  it("returns a not-found problem for unknown Function paths", async () => {
    const h = await harness();
    const response = await h.get("/v1/query/weapons/extra");
    expect(response.status).toBe(404);
    expect((await readBody(response)).type).toMatch(/#not-found$/);
  });
});
