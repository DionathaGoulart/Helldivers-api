import { Problem, SearchResponse } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { dynamicETag } from "../src/lib/etag.ts";
import { harness, readBody } from "./helpers.ts";

const hits = (body: { data: { collection: string; id: string }[] }) =>
  body.data.map((result) => `${result.collection}/${result.id}`);

describe("GET /v1/search", () => {
  it("returns matches with image and item URL", async () => {
    const h = await harness();
    const response = await h.get("/v1/search?q=liberator");
    expect(response.status).toBe(200);
    const body = SearchResponse.parse(await readBody(response));
    expect(body.data).toEqual([
      {
        collection: "weapons",
        id: "ar-23-liberator",
        name: "AR-23 Liberator",
        image: "/images/v1/weapons/ar-23-liberator.7068ca99.webp",
        url: "/v1/weapons/ar-23-liberator.json",
      },
    ]);
    expect(body.meta).toMatchObject({
      count: 1,
      total: 1,
      q: "liberator",
      collections: null,
      limit: 10,
    });
    expect(h.assets.requests).toEqual(["/v1/search-index.json"]);
  });

  it("ranks exact, prefix, word prefix and substring matches, then by name", async () => {
    const h = await harness();
    const body = await readBody(await h.get("/v1/search?q=castellan"));
    // `castellans creed` starts with the text; `city fighter s resolve` does not match at all.
    expect(hits(body)).toEqual(["warbonds/castellans-creed", "patterns/castellans-green"]);
    const words = await readBody(await h.get("/v1/search?q=creed"));
    expect(hits(words)).toEqual(["warbonds/castellans-creed"]);
  });

  it("ignores case, diacritics, punctuation and spaces", async () => {
    const h = await harness();
    for (const q of ["CITY FIGHTER’S", "cíty-fighters", "cityfighter"]) {
      const body = await readBody(await h.get(`/v1/search?q=${encodeURIComponent(q)}`));
      expect(hits(body)).toEqual([
        "capes/city-fighters-resolve",
        "player-cards/city-fighters-resolve",
      ]);
    }
  });

  it("matches aliases and restricts collections", async () => {
    const h = await harness();
    const alias = await readBody(await h.get("/v1/search?q=ops"));
    expect(hits(alias)).toEqual(["stratagems/orbital-precision-strike"]);
    const cards = await readBody(await h.get("/v1/search?q=city&collections=player-cards"));
    expect(hits(cards)).toEqual(["player-cards/city-fighters-resolve"]);
    expect(cards.meta.collections).toEqual(["player-cards"]);
  });

  it("applies the limit after ranking and reports the total", async () => {
    const h = await harness();
    const body = await readBody(await h.get("/v1/search?q=tg&limit=2"));
    // 2 armors, 2 helmets, 2 sets start with `tg`; `shotgun` contains it.
    expect(body.meta).toMatchObject({ count: 2, total: 7, limit: 2 });
    // Same score and name: collections in arch order (armors before helmets and sets).
    expect(hits(body)).toEqual(["armors/tg-122-demo-trooper", "helmets/tg-122-demo-trooper"]);
  });

  it("uses one ETag for equivalent URLs", async () => {
    const h = await harness();
    const response = await h.get("/v1/search?collections=titles,armors&q=tg&limit=10");
    expect(response.headers.get("etag")).toBe(
      dynamicETag(h.site.build.dataVersion, "/v1/search?q=tg&collections=armors,titles"),
    );
  });

  it.each([
    ["/v1/search", "invalid-parameter", "'q' is required and needs at least 2 letters or digits."],
    [
      "/v1/search?q=-",
      "invalid-parameter",
      "'q' is required and needs at least 2 letters or digits.",
    ],
    ["/v1/search?q=tg&limit=51", "invalid-parameter", "'limit' must be an integer from 1 to 50."],
    ["/v1/search?q=tg&q=ar", "invalid-parameter", "'q' can be given only once."],
    [
      "/v1/search?q=tg&collections=enemies",
      "invalid-parameter",
      "Unknown value 'enemies' for 'collections'. Allowed: warbonds, weapons, stratagems, armors, helmets, capes, armor-sets, boosters, passives, weapon-traits, player-cards, emotes, patterns, titles.",
    ],
    [
      "/v1/search?q=tg&page=2",
      "unknown-parameter",
      "Unknown parameter 'page' for /v1/search. Allowed: q, collections, limit.",
    ],
  ])("%s → 400 %s", async (path, type, detail) => {
    const h = await harness();
    const response = await h.get(path);
    expect(response.status).toBe(400);
    expect(Problem.parse(await readBody(response))).toMatchObject({
      type: expect.stringMatching(new RegExp(`#${type}$`)),
      detail,
    });
    expect(h.assets.requests).toEqual([]);
  });
});
