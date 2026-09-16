import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Collection, validateDataset } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import * as cheerio from "cheerio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLogger } from "../src/log.ts";
import { runScrape } from "../src/run.ts";
import { FixtureSource, type WikiPage, type WikiSource } from "../src/source.ts";
import { FIXTURES_DIR } from "./fixtures.ts";

// E2E offline (arch §11): fixtures → data/v1 in a temporary DATA_DIR.

const repoOverrides = join(import.meta.dirname, "..", "..", "..", "data", "overrides");
const INPUT_OVERRIDES = ["warbond-aliases.json", "source-labels.json", "warbond-stubs.json"];

/** Fixture source whose Boosters index lost some rows. */
class DroppingSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);

  constructor(readonly dropped: readonly string[]) {}

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.#inner.page(title);
    if (title !== "Boosters") {
      return page;
    }
    const $ = cheerio.load(page.html);
    $("table.wikitable tr")
      .filter((_, tr) => this.dropped.includes($(tr).children("td").eq(1).text().trim()))
      .remove();
    return { ...page, html: $.html() };
  }
}

let dir: string;
let dataDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hd2-run-"));
  dataDir = join(dir, "data");
  await mkdir(join(dataDir, "overrides"), { recursive: true });
  for (const file of INPUT_OVERRIDES) {
    await copyFile(join(repoOverrides, file), join(dataDir, "overrides", file));
  }
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (
  at: string,
  source: WikiSource = new FixtureSource(FIXTURES_DIR),
  allowDrop = false,
  only: Collection[] | null = null,
) =>
  runScrape({
    dataDir,
    source,
    http: null,
    only,
    allowDrop,
    fullRefresh: false,
    baseUrl: "https://helldivers.wiki.gg",
    userAgent: "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)",
    now: () => new Date(at),
    logger: silentLogger,
  });

async function readTree(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const tree: Record<string, string> = {};
  for (const file of files.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(file.parentPath, file.name);
    tree[relative(root, path)] = await readFile(path, "utf8");
  }
  return tree;
}

// A full run reads ~480 fixture pages.
describe("pnpm scrape --offline", { timeout: 120_000 }, () => {
  it("publishes every scraped collection equal to the golden snapshots", async () => {
    const report = await run("2026-09-15T21:07:00.123Z");

    expect(report.failure).toBeNull();
    expect(report).toMatchObject({ ok: true, changed: true, mode: "offline" });
    expect(report.counts).toEqual([
      { collection: "boosters", before: 0, after: 18 },
      { collection: "passives", before: 0, after: 31 },
      { collection: "weapon-traits", before: 0, after: 28 },
      { collection: "weapons", before: 0, after: 104 },
      { collection: "stratagems", before: 0, after: 114 },
      { collection: "armors", before: 0, after: 109 },
      { collection: "helmets", before: 0, after: 110 },
      { collection: "capes", before: 0, after: 89 },
      { collection: "armor-sets", before: 0, after: 109 },
      { collection: "player-cards", before: 0, after: 76 },
      { collection: "emotes", before: 0, after: 48 },
      { collection: "patterns", before: 0, after: 27 },
      { collection: "titles", before: 0, after: 56 },
    ]);
    // Unreleased Ironclad Democracy items (their passive, costs, stats and descriptions, the two
    // player cards missing from the Cosmetics grid), the Source-less CQC-73 Entrenchment Tool and
    // one cape page without an Armory quote.
    expect(report.warnings).toEqual([
      "passives: Blunt-Force Mitigation is not listed on Armor Passives; read https://helldivers.wiki.gg/wiki/Blunt-Force_Mitigation",
      'weapons/ar-11-arbitrator: cost not announced ("? Medals")',
      "weapons/ar-11-arbitrator: no detailed statistics tables on https://helldivers.wiki.gg/wiki/AR-11_Arbitrator",
      'weapons/gl-15-evictor: cost not announced ("Medals")',
      "weapons/gl-15-evictor: no detailed statistics tables on https://helldivers.wiki.gg/wiki/GL-15_Evictor",
      "weapons/cqc-73-entrenchment-tool: source read from the Procurement section (Entrenched Division Premium Warbond)",
      'weapons/p-34-breacher: cost not announced ("Medals")',
      "weapons/p-34-breacher: no detailed statistics tables on https://helldivers.wiki.gg/wiki/P-34_Breacher",
      'weapons/g-60-anti-tank-seeker: cost not announced ("Medals")',
      "weapons/g-60-anti-tank-seeker: no detailed statistics tables on https://helldivers.wiki.gg/wiki/G-60_Anti-Tank_Seeker",
      'weapons/g-8-immolation: cost not announced ("Medals")',
      "weapons/g-8-immolation: no detailed statistics tables on https://helldivers.wiki.gg/wiki/G-8_Immolation",
      'armors/bfm-16-tanker: cost not announced ("Medals")',
      "armors/bfm-16-tanker: no Armory description on https://helldivers.wiki.gg/wiki/BFM-16_Tanker",
      'armors/bfm-220-ironclad: cost not announced ("Medals")',
      "armors/bfm-220-ironclad: no Armory description on https://helldivers.wiki.gg/wiki/BFM-220_Ironclad",
      'helmets/bfm-220-ironclad: cost not announced ("Medals")',
      'helmets/bfm-16-tanker: cost not announced ("Medals")',
      "capes/watchful-compatriot: no Armory description on https://helldivers.wiki.gg/wiki/Watchful_Compatriot",
      'capes/standard-of-rapid-evacuation: cost not announced ("Medals")',
      "capes/standard-of-rapid-evacuation: no Armory description on https://helldivers.wiki.gg/wiki/Standard_of_Rapid_Evacuation",
      'capes/shroud-of-the-juggernaut: cost not announced ("Medals")',
      "capes/shroud-of-the-juggernaut: no Armory description on https://helldivers.wiki.gg/wiki/Shroud_of_the_Juggernaut",
      'player-cards/standard-of-rapid-evacuation: cost not announced ("Medals")',
      'player-cards/shroud-of-the-juggernaut: cost not announced ("Medals")',
    ]);
    expect(report.changes.every((change) => change.kind === "added")).toBe(true);
    expect(report.dataVersion).toMatch(/^2026-09-15\.[a-f0-9]{8}$/);

    const { files, issues } = await readDatasetFiles(join(dataDir, "v1"));
    expect(issues).toEqual([]);
    const stubs = JSON.parse(
      await readFile(join(dataDir, "overrides", "warbond-stubs.json"), "utf8"),
    );
    expect(validateDataset(files, { knownIds: { warbonds: new Set(stubs) } })).toEqual([]);
    // meta + changelog + conflicts, then one list and one file per entity for each collection.
    expect(files.size).toBe(
      3 +
        (1 + 18) +
        (1 + 31) +
        (1 + 28) +
        (1 + 104) +
        (1 + 114) +
        (1 + 109) +
        (1 + 110) +
        (1 + 89) +
        (1 + 109) +
        (1 + 76) +
        (1 + 48) +
        (1 + 27) +
        (1 + 56),
    );
    expect(files.get("meta.json")).toMatchObject({ generatedAt: "2026-09-15T21:07:00Z" });

    const collections = [
      "boosters",
      "passives",
      "weapon-traits",
      "weapons",
      "stratagems",
      "armors",
      "helmets",
      "capes",
      "armor-sets",
      "player-cards",
      "emotes",
      "patterns",
      "titles",
    ];
    for (const collection of collections) {
      const list = (files.get(`${collection}.json`) as { data: unknown[] }).data;
      await expect(`${JSON.stringify(list, null, 2)}\n`).toMatchFileSnapshot(
        `./__snapshots__/${collection}.offline.json`,
      );
    }
    expect(files.get("passives/true-grit.json")).toMatchObject({
      data: {
        wiki: { title: "True Grit", url: "https://helldivers.wiki.gg/wiki/True_Grit", flags: [] },
        effects: [
          "Increases reload speed of support weapons by 30%.",
          "Slightly increases weapon ergonomics to reduce drag on weapon movement.",
        ],
        armorIds: ["tg-122-demo-trooper", "tg-8-sharpshooter"],
      },
    });
    expect(files.get("weapon-traits/light-armor-penetrating.json")).toMatchObject({
      data: {
        name: "Light Armor Penetrating",
        wiki: {
          title: "Equipment Traits",
          url: "https://helldivers.wiki.gg/wiki/Equipment_Traits#Light_Armor_Penetrating",
        },
        weaponIds: expect.arrayContaining(["ar-23-liberator", "sg-8-punisher"]),
        stratagemIds: expect.arrayContaining(["ax-las-5-rover"]),
      },
    });

    // AR-23 Liberator equals arch §5.4 except the image, which arrives in Phase 4.
    const example = JSON.parse(
      await readFile(
        join(import.meta.dirname, "../../schemas/test/examples/weapons.ar-23-liberator.json"),
        "utf8",
      ),
    );
    const liberator = (
      files.get("weapons/ar-23-liberator.json") as { data: Record<string, unknown> }
    ).data;
    const { statsRaw, ...rest } = liberator;
    expect(rest).toEqual({ ...example, statsRaw: undefined, image: null, wiki: example.wiki });
    expect(statsRaw).toMatchObject(example.statsRaw);
    expect(files.get("weapons/r-40-k-hot-shot-marksman-rifle.json")).toMatchObject({
      data: { source: { warbondId: "castellans-creed", page: 1, cost: { amount: 35 } } },
    });
    expect(files.get("weapons/cqc-73-entrenchment-tool.json")).toMatchObject({
      data: {
        name: "Entrenchment Tool",
        aliases: ["CQC-73 Entrenchment Tool"],
        source: {
          warbondId: "entrenched-division",
          page: 1,
          cost: { currency: "medals", amount: 20 },
        },
      },
    });

    // Orbital Precision Strike equals arch §5.4 except the image; table rows of `statsRaw` are
    // keyed by table title. MG-43 Machine Gun equals the fields the audit captured.
    const stratagem = async (id: string) => ({
      example: JSON.parse(
        await readFile(
          join(import.meta.dirname, `../../schemas/test/examples/stratagems.${id}.json`),
          "utf8",
        ),
      ),
      data: (files.get(`stratagems/${id}.json`) as { data: Record<string, unknown> }).data,
    });
    const ops = await stratagem("orbital-precision-strike");
    const { statsRaw: opsRaw, shipModules, attacks, ...opsRest } = ops.data;
    expect(opsRest).toEqual({
      ...ops.example,
      image: null,
      statsRaw: undefined,
      shipModules: undefined,
      attacks: undefined,
    });
    expect(shipModules).toHaveLength(5);
    expect(
      (attacks as { name: string; kind: string }[]).map(({ name, kind }) => ({ name, kind })),
    ).toEqual(
      ops.example.attacks.map(({ name, kind }: { name: string; kind: string }) => ({ name, kind })),
    );
    expect(opsRaw).toMatchObject(
      Object.fromEntries(
        Object.entries(ops.example.statsRaw).map(([key, value]) => [
          `Orbital Precision Strike › ${key}`,
          value,
        ]),
      ),
    );
    const mg43 = await stratagem("mg-43-machine-gun");
    const captured = [
      "id",
      "name",
      "permitType",
      "availability",
      "category",
      "kind",
      "traitIds",
      "code",
      "cooldownS",
      "callInTimeS",
      "callInTimeUpgradedS",
      "uses",
      "unlockLevel",
      "supportWeapon",
      "backpack",
      "source",
    ];
    for (const field of captured) {
      expect(mg43.data[field], field).toEqual(mg43.example[field]);
    }
    expect(files.get("stratagems/40-k-meltagun.json")).toMatchObject({
      data: { source: { warbondId: "castellans-creed", page: 3, cost: { amount: 110 } } },
    });
    expect(files.get("stratagems/reinforce.json")).toMatchObject({
      data: {
        permitType: "mission",
        availability: "mission",
        kind: "mission",
        source: { type: "other", label: "", cost: null },
      },
    });

    // TG-8 Sharpshooter armor and helmet equal arch §5.4 except the image. The helmet keeps its
    // page cost (30); the warbond table's 39 is resolved with the warbonds (plan 3g).
    for (const collection of ["armors", "helmets"]) {
      const example = JSON.parse(
        await readFile(
          join(
            import.meta.dirname,
            `../../schemas/test/examples/${collection}.tg-8-sharpshooter.json`,
          ),
          "utf8",
        ),
      );
      expect(files.get(`${collection}/tg-8-sharpshooter.json`)).toEqual({
        meta: expect.anything(),
        data: { ...example, image: null },
      });
    }
    expect(files.get("armors/sc-37-legionnaire.json")).toMatchObject({
      data: { weight: "light", armorRating: 50, speed: 550, staminaRegen: 125 },
    });
    expect(files.get("armors/cph-26-commandant.json")).toMatchObject({
      data: { name: "CPH-26 Commandant", aliases: [] },
    });
    expect(files.get("helmets/ix-voidwalker.json")).toMatchObject({
      data: {
        description: expect.stringMatching(/^A helmet worn by the pioneering Helldivers/),
        setIds: [],
        source: { type: "event", label: "Void Piercer", cost: null },
      },
    });
    // Capes: the page gives no page number, so the warbond table does (rule 3); sets are linked
    // in plan 3g, the player card of the same page by the link step (rule 9).
    expect(files.get("capes/city-fighters-resolve.json")).toMatchObject({
      data: {
        description: expect.stringMatching(/^The Helldivers are all that stand between/),
        setIds: [],
        playerCardId: "city-fighters-resolve",
        source: {
          warbondId: "castellans-creed",
          page: 2,
          cost: { currency: "medals", amount: 25 },
        },
      },
    });
    expect(files.get("armor-sets/tg-8-sharpshooter.json")).toMatchObject({
      data: {
        armorId: "tg-8-sharpshooter",
        helmetId: "tg-8-sharpshooter",
        capeId: null,
        capeLink: null,
      },
    });
    expect(files.get("passives/blunt-force-mitigation.json")).toMatchObject({
      data: { armorIds: ["bfm-16-tanker", "bfm-220-ironclad"] },
    });

    // Cosmetics equal arch §5.4 except images (Phase 4). The Castellans Green page lead has since
    // been split from its acquisition paragraph, and the Sergeant row links its own page.
    const readExample = async (name: string) =>
      JSON.parse(
        await readFile(
          join(import.meta.dirname, `../../schemas/test/examples/${name}.json`),
          "utf8",
        ),
      );
    const withoutImages = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value), (key, inner) => (key === "image" ? null : inner));
    for (const name of [
      "player-cards.city-fighters-resolve",
      "emotes.clapping",
      "patterns.arctic",
      "titles.viper-commando",
      "titles.sergeant",
    ]) {
      const [collection, id] = name.split(".");
      expect(files.get(`${collection}/${id}.json`), name).toEqual({
        meta: expect.anything(),
        data: withoutImages(await readExample(name)),
      });
    }
    expect(files.get("patterns/castellans-green.json")).toEqual({
      meta: expect.anything(),
      data: {
        ...(withoutImages(await readExample("patterns.castellans-green")) as object),
        description: "Castellans Green patterns are selectable wraps for your various vehicles.",
      },
    });
    expect(files.get("player-cards/solid-black.json")).toMatchObject({
      data: {
        wiki: { title: "Solid Black", flags: [] },
        pairedCapeId: null,
        source: { type: "default", label: "Starter Equipment", cost: null },
      },
    });
    expect(files.get("patterns/standard.json")).toMatchObject({
      data: {
        variants: ["hellpod", "shuttle", "exosuit", "vehicle"].map((target) => ({
          target,
          image: null,
          source: { type: "default", label: "Starter Equipment", cost: null },
        })),
      },
    });
    expect(files.get("titles/super-citizen.json")).toMatchObject({
      data: { source: { type: "edition", cost: { currency: "usd", amount: 20 } } },
    });
    expect(files.get("titles/assault-infantry.json")).toMatchObject({
      data: { source: { warbondId: "righteous-revenants", page: 3 } },
    });

    // Civilian weapons: SG-88 equals arch §5.4 except the image, the table-keyed `statsRaw` and
    // the maintenance flag the audit did not capture; the CQC-72 page is named Trench Shovel in
    // game and mentions CQC-73's warbond.
    const sg88 = await readExample("weapons.sg-88-break-action-shotgun");
    const { statsRaw: sg88Raw, ...sg88Rest } = (
      files.get("weapons/sg-88-break-action-shotgun.json") as { data: Record<string, unknown> }
    ).data;
    expect(sg88Rest).toEqual({
      ...sg88,
      statsRaw: undefined,
      image: null,
      wiki: { ...sg88.wiki, flags: ["potentially_outdated"] },
    });
    expect(sg88Raw).toMatchObject({
      "Standard Damage": "585 Ballistic",
      "SG-88 BREAK-ACTION SHOTGUN › Barrels": "x 2",
    });
    expect(files.get("weapons/cqc-72-entrenchment-tool.json")).toMatchObject({
      data: {
        name: "Trench Shovel",
        aliases: ["CQC-72 Entrenchment Tool"],
        category: "civilian",
        subcategory: "melee",
        firearm: null,
        source: { type: "other", label: "Minor Places of Interest", cost: null },
      },
    });
    expect(files.get("stratagems/aquifer-drill.json")).toMatchObject({
      data: { wiki: { flags: ["stub"] } },
    });

    const conflicts = (
      files.get("reports/conflicts.json") as { conflicts: { id: string; field: string }[] }
    ).conflicts;
    // Rule 10: the warbond table places Castellans Green Exosuit on page 3, its page tab on 1.
    expect(conflicts.filter((conflict) => conflict.id === "castellans-green")).toEqual([
      {
        collection: "patterns",
        id: "castellans-green",
        field: "variants[2].source.page",
        rule: 10,
        chosen: 3,
        candidates: [
          {
            page: "https://helldivers.wiki.gg/wiki/Castellan%E2%80%99s_Creed_Legendary_Warbond",
            location: "Page 3 › Castellans Green Exosuit",
            value: 3,
          },
          {
            page: "https://helldivers.wiki.gg/wiki/Castellans_Green_Pattern",
            location: "infobox › Exosuit › Source",
            value: 1,
          },
        ],
      },
    ]);
    expect(conflicts).toContainEqual({
      collection: "stratagems",
      id: "b-1-supply-pack",
      field: "callInTimeS",
      rule: 2,
      chosen: 5,
      candidates: [
        {
          page: "https://helldivers.wiki.gg/wiki/B-1_Supply_Pack",
          location: "General › Call-in Time",
          value: 9.75,
        },
        {
          page: "https://helldivers.wiki.gg/wiki/B-1_Supply_Pack",
          location: "B-1 Supply Pack › Call-in Time",
          value: 5,
        },
      ],
    });
    expect(conflicts).toContainEqual(
      expect.objectContaining({
        id: "mg-43-machine-gun",
        field: "supportWeapon.magazinesFromSupply",
      }),
    );
    expect(conflicts).toContainEqual({
      collection: "weapons",
      id: "ar-23-liberator",
      field: "firearm.recoil",
      rule: 2,
      chosen: 10.5,
      candidates: [
        {
          page: "https://helldivers.wiki.gg/wiki/AR-23_Liberator",
          location: "infobox › Recoil",
          value: 14,
        },
        {
          page: "https://helldivers.wiki.gg/wiki/AR-23_Liberator",
          location: "AR-23 LIBERATOR › Recoil",
          value: 10.5,
        },
      ],
    });

    const lock = JSON.parse(await readFile(join(dataDir, "overrides", "ids.lock.json"), "utf8"));
    expect(Object.keys(lock.boosters)).toHaveLength(18);
    expect(lock.boosters["Hellpod Space Optimization"]).toBe("hellpod-space-optimization");
    expect(Object.keys(lock.passives)).toHaveLength(31);
    expect(lock.passives["Concussive Padding, Grenadier"]).toBe("concussive-padding-grenadier");
    expect(Object.keys(lock["weapon-traits"])).toHaveLength(28);
    expect(lock["weapon-traits"]["Equipment Traits#Anti-Tank"]).toBe("anti-tank");
    expect(Object.keys(lock.weapons)).toHaveLength(104);
    expect(lock.weapons["AR/GL-21 One-Two"]).toBe("ar-gl-21-one-two");
    expect(Object.keys(lock.stratagems)).toHaveLength(114);
    expect(lock.stratagems["A/MG-43 Machine Gun Sentry"]).toBe("a-mg-43-machine-gun-sentry");
    for (const [collection, count] of [
      ["armors", 109],
      ["helmets", 110],
      ["capes", 89],
      ["armor-sets", 109],
      ["player-cards", 76],
      ["emotes", 48],
      ["patterns", 27],
      ["titles", 56],
    ] as const) {
      expect(Object.keys(lock[collection]), collection).toHaveLength(count);
    }
    expect(lock.capes["Cloak of Posterity's Gratitude"]).toBe("cloak-of-posteritys-gratitude");
    expect(lock.patterns["Castellans Green Pattern"]).toBe("castellans-green");
    expect(lock.patterns["Cosmetics#Patterns/Arctic"]).toBe("arctic");
    expect(lock.titles.Redacted).toBe("redacted");
  });

  it("changes nothing on a second run with the same pages", async () => {
    await run("2026-09-15T21:07:00Z");
    const before = await readTree(dataDir);

    const report = await run("2026-09-16T21:07:00Z");
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("fails with count-drop when 3 of 18 rows disappear and leaves data untouched", async () => {
    await run("2026-09-15T21:07:00Z", undefined, false, ["boosters"]);
    const before = await readTree(dataDir);

    const report = await run(
      "2026-09-16T21:07:00Z",
      new DroppingSource(["Stun Pods", "Dead Sprint", "Sample Scanner"]),
      false,
      ["boosters"],
    );
    expect(report.ok).toBe(false);
    expect(report.failure?.kind).toBe("count-drop");
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("publishes a removal when 1 of 18 rows disappears", async () => {
    await run("2026-09-15T21:07:00Z", undefined, false, ["boosters"]);
    const report = await run("2026-09-16T21:07:00Z", new DroppingSource(["Stun Pods"]), false, [
      "boosters",
    ]);

    expect(report).toMatchObject({ ok: true, changed: true });
    expect(report.changes).toEqual([{ collection: "boosters", id: "stun-pods", kind: "removed" }]);
    const changelog = JSON.parse(await readFile(join(dataDir, "v1", "changelog.json"), "utf8"));
    expect(changelog.data.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-09-16",
      "2026-09-15",
    ]);
  });

  it("keeps the cape ⇄ player card pairs on a capes-only run", async () => {
    await run("2026-09-15T21:07:00Z");
    const before = await readTree(dataDir);

    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["capes"]);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("refreshes weapon trait back-references on a weapons-only run", async () => {
    await run("2026-09-15T21:07:00Z", undefined, false, ["weapon-traits", "weapons"]);
    const lap = join(dataDir, "v1", "weapon-traits", "light-armor-penetrating.json");
    const before = await readFile(lap, "utf8");
    const published = JSON.parse(before);
    published.data.weaponIds = [];
    const list = join(dataDir, "v1", "weapon-traits.json");
    const traits = JSON.parse(await readFile(list, "utf8"));
    traits.data.find((trait: { id: string }) => trait.id === "light-armor-penetrating").weaponIds =
      [];
    await writeFile(lap, `${JSON.stringify(published, null, 2)}\n`);
    await writeFile(list, `${JSON.stringify(traits, null, 2)}\n`);

    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["weapons"]);
    expect(report).toMatchObject({ ok: true, changed: true });
    expect(report.changes).toEqual([
      {
        collection: "weapon-traits",
        id: "light-armor-penetrating",
        kind: "changed",
        paths: ["weaponIds"],
      },
    ]);
    expect(JSON.parse(await readFile(lap, "utf8")).data.weaponIds).toEqual(
      JSON.parse(before).data.weaponIds,
    );
  });

  it.each([
    [["weapons"], "weapons need the weapon-traits collection: scrape weapon-traits first"],
    [["armors"], "armors need the passives collection: scrape passives first"],
    [["armor-sets"], "armor-sets need the armors and helmets collections: scrape them first"],
    [["player-cards"], "player-cards need the capes collection: scrape capes first"],
  ] as const)("needs the collections %j resolves against", async (only, message) => {
    const report = await run("2026-09-15T21:07:00Z", undefined, false, [...only]);
    expect(report.failure).toEqual({ kind: "error", messages: [message] });
  });

  it("refuses a collection that is not scraped yet", async () => {
    const report = await runScrape({
      dataDir,
      source: new FixtureSource(FIXTURES_DIR),
      http: null,
      only: ["warbonds"],
      allowDrop: false,
      fullRefresh: false,
      baseUrl: "https://helldivers.wiki.gg",
      userAgent: "test",
      now: () => new Date("2026-09-15T21:07:00Z"),
      logger: silentLogger,
    });
    expect(report.failure).toEqual({
      kind: "error",
      messages: [
        "warbonds is not scraped yet (available: boosters, passives, weapon-traits, weapons, stratagems, armors, helmets, capes, armor-sets, player-cards, emotes, patterns, titles)",
      ],
    });
  });
});
