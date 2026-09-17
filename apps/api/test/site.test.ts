import {
  Booster,
  Collection,
  collectionSchemas,
  DatasetManifest,
  List,
  type Pattern,
} from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { checkDist, MAX_FILE_BYTES, MAX_FILES } from "../scripts/site/checks.ts";
import { csvColumns, renderCsv } from "../scripts/site/csv.ts";
import { FACETS } from "../scripts/site/facets.ts";
import { expandStaticPaths, isDynamicPath } from "../scripts/site/openapi.ts";
import { SearchIndex } from "../src/search-index.ts";
import { syntheticSite } from "./helpers.ts";

const json = (text: string | undefined) => JSON.parse(text ?? "null");

/** Every dist path of the synthetic build: pages, copied data, generated files, worker. */
async function distSizes(): Promise<Map<string, number>> {
  const { files, site } = await syntheticSite();
  const sizes = new Map<string, number>([
    ["index.html", 1],
    ["404.html", 1],
    ["_worker.js", 1],
  ]);
  for (const path of files.keys()) sizes.set(`v1/${path}`, 1);
  for (const [path, text] of site.files) sizes.set(path, text.length);
  return sizes;
}

describe("buildSite", () => {
  it("routes only the dynamic paths to the Functions", async () => {
    const { site } = await syntheticSite();
    expect(json(site.files.get("_routes.json"))).toEqual({
      version: 1,
      include: ["/v1/query/*", "/v1/search", "/images/*"],
      exclude: [],
    });
  });

  it("writes _headers with the data version and CORS set exactly once per path", async () => {
    const { site } = await syntheticSite();
    const headers = site.files.get("_headers") ?? "";
    expect(headers).toContain(`  X-Data-Version: ${site.build.dataVersion}\n`);
    expect(headers).toContain(
      "  Cache-Control: public, max-age=300, stale-while-revalidate=3600\n",
    );
    expect(headers.match(/Access-Control-Allow-Origin/g)).toHaveLength(1);
    expect(headers.match(/X-Content-Type-Options/g)).toHaveLength(1);
  });

  it("redirects every extensionless collection URL", async () => {
    const { site } = await syntheticSite();
    const rules = (site.files.get("_redirects") ?? "").trim().split("\n");
    expect(rules).toHaveLength(Collection.options.length);
    expect(rules).toContain("/v1/armor-sets /v1/armor-sets.json 301");
  });

  it("adds collection URLs to meta.json", async () => {
    const { site } = await syntheticSite();
    const manifest = DatasetManifest.parse(json(site.files.get("v1/meta.json")));
    expect(manifest.collections["armor-sets"]).toEqual({
      count: 2,
      url: "/v1/armor-sets.json",
      csv: "/v1/armor-sets.csv",
      schema: "/v1/schemas/armor-set.json",
    });
  });

  it("bakes the version and the ids query filters accept into the Functions", async () => {
    const { site } = await syntheticSite();
    expect(site.build).toEqual({
      dataVersion: "2026-09-15.0d15ea5e",
      generatedAt: "2026-09-15T21:07:00Z",
      ids: {
        "armor-sets": ["tg-122-demo-trooper", "tg-8-sharpshooter"],
        passives: ["true-grit"],
        warbonds: ["castellans-creed", "helldivers-mobilize", "viper-commandos"],
        "weapon-traits": expect.arrayContaining(["light-armor-penetrating", "orbital"]),
      },
    });
  });

  it("writes one valid list per facet value, empty lists included", async () => {
    const { site } = await syntheticSite();
    let count = 0;
    for (const [path, text] of site.files) {
      const match = /^v1\/([a-z-]+)\/by-[a-z-]+\/[a-z0-9_-]+\.json$/.exec(path);
      if (!match) continue;
      const collection = Collection.parse(match[1]);
      const list = List(collectionSchemas[collection]).parse(JSON.parse(text));
      expect(list.meta.count).toBe(list.data.length);
      count++;
    }
    // 10 acquirable collections × (3 warbonds + 10 source types) + 4 + 6 + 3 + 2 + 2 + 2.
    expect(count).toBe(10 * 13 + 19);
    expect(FACETS).toHaveLength(26);

    const ids = (path: string) =>
      json(site.files.get(path)).data.map((item: { id: string }) => item.id);
    expect(ids("v1/weapons/by-warbond/castellans-creed.json")).toEqual([
      "g-40-k-melta-mine",
      "p-40-k-bolt-pistol",
      "r-40-k-hot-shot-marksman-rifle",
    ]);
    expect(ids("v1/weapons/by-category/civilian.json")).toEqual(["sg-88-break-action-shotgun"]);
    expect(ids("v1/stratagems/by-category/patriotic-administration-center.json")).toEqual([
      "mg-43-machine-gun",
    ]);
    expect(ids("v1/patterns/by-warbond/castellans-creed.json")).toEqual(["castellans-green"]);
    expect(ids("v1/emotes/by-kind/victory-pose.json")).toEqual(["clapping"]);
    expect(ids("v1/emotes/by-kind/emote.json")).toEqual([]);
    expect(ids("v1/boosters/by-warbond/viper-commandos.json")).toEqual([]);
    // Source types keep their data value; only departments are kebab-cased (arch §8.2).
    expect(ids("v1/titles/by-source/progression.json")).toEqual(["sergeant"]);
    expect(site.files.has("v1/titles/by-source/pre_order.json")).toBe(true);
  });

  it("indexes every entity with normalized terms and its image", async () => {
    const { files, site } = await syntheticSite();
    const index = SearchIndex.parse(json(site.files.get("v1/search-index.json")));
    const total = Collection.options.reduce(
      (sum, collection) =>
        sum + (files.get(`${collection}.json`) as { data: unknown[] }).data.length,
      0,
    );
    expect(index.data).toHaveLength(total);
    expect(index.meta.count).toBe(total);
    expect(index.data).toContainEqual([
      "warbonds",
      "castellans-creed",
      "Castellan's Creed",
      "/images/v1/warbonds/castellans-creed.0fba0057.webp",
      ["castellan s creed"],
    ]);
    expect(index.data).toContainEqual([
      "armor-sets",
      "tg-8-sharpshooter",
      "TG-8 Sharpshooter",
      null,
      ["tg 8 sharpshooter"],
    ]);
  });

  it("documents a static path only when the build writes every file behind it", async () => {
    const { site } = await syntheticSite();
    const sizes = await distSizes();
    expect(checkDist(sizes, site.openapi, site.data.dataset)).toEqual([]);

    const urls = expandStaticPaths(site.openapi, site.data.dataset);
    expect(urls).toContain("/v1/weapons/ar-23-liberator.json");
    expect(urls).toContain("/v1/capes/by-warbond/viper-commandos.json");
    expect(urls).toContain("/v1/stratagems/by-category/orbital-cannons.json");
    expect(urls).toContain("/v1/schemas/dataset-manifest.json");
    expect(urls.some(isDynamicPath)).toBe(false);

    sizes.delete("v1/titles/by-kind/rank.json");
    expect(checkDist(sizes, site.openapi, site.data.dataset)).toEqual([
      "/v1/titles/by-kind/rank.json: documented in openapi.json but not built",
    ]);
  });

  it("enforces the Pages file limits", async () => {
    const { site } = await syntheticSite();
    const sizes = await distSizes();
    sizes.set("v1/huge.json", MAX_FILE_BYTES);
    // `_worker.js`, `_headers`, `_redirects` and `_routes.json` are not assets.
    for (let i = sizes.size; i < MAX_FILES + 4; i++) sizes.set(`filler/${i}`, 1);
    expect(checkDist(sizes, site.openapi, site.data.dataset)).toEqual([
      `${MAX_FILES} files: Pages allows fewer than ${MAX_FILES}`,
      `v1/huge.json: ${MAX_FILE_BYTES} bytes, Pages allows < 25 MiB`,
    ]);
  });
});

describe("OpenAPI document", () => {
  it("declares every route with components from the zod schemas", async () => {
    const { site } = await syntheticSite();
    const { openapi } = site;
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi["x-data-version"]).toBe(site.build.dataVersion);
    for (const collection of Collection.options) {
      expect(openapi.paths).toHaveProperty([`/v1/${collection}.json`]);
      expect(openapi.paths).toHaveProperty([`/v1/query/${collection}`]);
      expect(openapi.paths).toHaveProperty([`/v1/${collection}.csv`]);
    }
    expect(openapi.paths).toHaveProperty(["/v1/search"]);
    expect(openapi.paths).toHaveProperty(["/images/v1/{collection}/{file}"]);
    expect(openapi.components.schemas.WeaponList).toEqual({
      type: "object",
      properties: {
        meta: { $ref: "#/components/schemas/Meta" },
        data: { type: "array", items: { $ref: "#/components/schemas/Weapon" } },
      },
      required: ["meta", "data"],
    });
    const operationIds = Object.values(openapi.paths).map(({ get }) => get.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("describes query filters as comma-separated OR lists with their values", async () => {
    const { site } = await syntheticSite();
    const parameters = site.openapi.paths["/v1/query/weapons"]?.get.parameters as {
      name: string;
      style?: string;
      explode?: boolean;
      schema: { items?: { enum?: string[] } };
    }[];
    expect(parameters.map((parameter) => parameter.name)).toEqual([
      "category",
      "subcategory",
      "warbond",
      "source",
      "trait",
      "firingMode",
      "q",
      "sort",
      "fields",
      "page",
      "limit",
    ]);
    expect(parameters[0]).toMatchObject({
      style: "form",
      explode: false,
      schema: { type: "array", items: { enum: ["primary", "secondary", "throwable", "civilian"] } },
    });
  });
});

describe("renderCsv", () => {
  const booster = Booster.parse({
    id: "x",
    slug: "x",
    name: '=HYPERLINK("http://evil")',
    aliases: ["a", "b"],
    description: "Line one,\nline two",
    image: null,
    wiki: { title: "X", url: "https://helldivers.wiki.gg/wiki/X", flags: [] },
    effect: "-50% cooldown",
    source: { type: "default", label: "", warbondId: null, page: null, cost: null, rotating: null },
  });

  it("flattens nested objects into dotted columns from the schema", () => {
    expect(csvColumns("boosters").map((column) => column.path.join("."))).toEqual([
      "id",
      "slug",
      "name",
      "aliases",
      "description",
      "image.url",
      "image.width",
      "image.height",
      "image.wikiFile",
      "wiki.title",
      "wiki.url",
      "wiki.flags",
      "effect",
      "source.type",
      "source.label",
      "source.warbondId",
      "source.page",
      "source.cost.currency",
      "source.cost.amount",
      "source.rotating",
    ]);
  });

  it("quotes, joins lists and neutralizes formulas", () => {
    const [header, row, end] = renderCsv("boosters", [booster]).split("\r\n");
    expect(header?.startsWith("id,slug,name,aliases,")).toBe(true);
    expect(row).toBe(
      'x,x,"\'=HYPERLINK(""http://evil"")",a;b,"Line one,\nline two",,,,,X,https://helldivers.wiki.gg/wiki/X,,\'-50% cooldown,default,,,,,,',
    );
    expect(end).toBe("");
  });

  it("writes object lists and records as JSON", async () => {
    const { site } = await syntheticSite();
    const csv = site.files.get("v1/patterns.csv") ?? "";
    const columns = csvColumns("patterns");
    expect(columns.find((column) => column.path[0] === "variants")?.kind).toBe("json");
    expect(csvColumns("weapons").find((column) => column.path[0] === "statsRaw")?.kind).toBe(
      "json",
    );
    expect(csv.split("\r\n")).toHaveLength(2 + 2); // header, 2 patterns, trailing newline
    const pattern: Pick<Pattern, "id"> = { id: "arctic" };
    expect(csv).toContain(`\r\n${pattern.id},`);
  });
});
