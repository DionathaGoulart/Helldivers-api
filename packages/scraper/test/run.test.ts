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

// Each run reads ~250 fixture pages.
describe("pnpm scrape --offline", { timeout: 120_000 }, () => {
  it("publishes boosters, passives, weapon traits, weapons and stratagems equal to the golden snapshots", async () => {
    const report = await run("2026-09-15T21:07:00.123Z");

    expect(report.failure).toBeNull();
    expect(report).toMatchObject({ ok: true, changed: true, mode: "offline" });
    expect(report.counts).toEqual([
      { collection: "boosters", before: 0, after: 18 },
      { collection: "passives", before: 0, after: 30 },
      { collection: "weapon-traits", before: 0, after: 28 },
      { collection: "weapons", before: 0, after: 102 },
      { collection: "stratagems", before: 0, after: 114 },
    ]);
    // Unreleased Ironclad Democracy weapons and the Source-less CQC-73 Entrenchment Tool.
    expect(report.warnings).toEqual([
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
    expect(files.size).toBe(3 + (1 + 18) + (1 + 30) + (1 + 28) + (1 + 102) + (1 + 114));
    expect(files.get("meta.json")).toMatchObject({ generatedAt: "2026-09-15T21:07:00Z" });

    for (const collection of ["boosters", "passives", "weapon-traits", "weapons", "stratagems"]) {
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

    const conflicts = (
      files.get("reports/conflicts.json") as { conflicts: { id: string; field: string }[] }
    ).conflicts;
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
    expect(Object.keys(lock.passives)).toHaveLength(30);
    expect(lock.passives["Concussive Padding, Grenadier"]).toBe("concussive-padding-grenadier");
    expect(Object.keys(lock["weapon-traits"])).toHaveLength(28);
    expect(lock["weapon-traits"]["Equipment Traits#Anti-Tank"]).toBe("anti-tank");
    expect(Object.keys(lock.weapons)).toHaveLength(102);
    expect(lock.weapons["AR/GL-21 One-Two"]).toBe("ar-gl-21-one-two");
    expect(Object.keys(lock.stratagems)).toHaveLength(114);
    expect(lock.stratagems["A/MG-43 Machine Gun Sentry"]).toBe("a-mg-43-machine-gun-sentry");
  });

  it("changes nothing on a second run with the same pages", async () => {
    await run("2026-09-15T21:07:00Z");
    const before = await readTree(dataDir);

    const report = await run("2026-09-16T21:07:00Z");
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("fails with count-drop when 3 of 18 rows disappear and leaves data untouched", async () => {
    await run("2026-09-15T21:07:00Z");
    const before = await readTree(dataDir);

    const report = await run(
      "2026-09-16T21:07:00Z",
      new DroppingSource(["Stun Pods", "Dead Sprint", "Sample Scanner"]),
    );
    expect(report.ok).toBe(false);
    expect(report.failure?.kind).toBe("count-drop");
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("publishes a removal when 1 of 18 rows disappears", async () => {
    await run("2026-09-15T21:07:00Z");
    const report = await run("2026-09-16T21:07:00Z", new DroppingSource(["Stun Pods"]));

    expect(report).toMatchObject({ ok: true, changed: true });
    expect(report.changes).toEqual([{ collection: "boosters", id: "stun-pods", kind: "removed" }]);
    const changelog = JSON.parse(await readFile(join(dataDir, "v1", "changelog.json"), "utf8"));
    expect(changelog.data.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-09-16",
      "2026-09-15",
    ]);
  });

  it("refreshes weapon trait back-references on a weapons-only run", async () => {
    await run("2026-09-15T21:07:00Z");
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

  it("needs weapon traits before weapons", async () => {
    const report = await run("2026-09-15T21:07:00Z", undefined, false, ["weapons"]);
    expect(report.failure).toEqual({
      kind: "error",
      messages: ["weapons need the weapon-traits collection: scrape weapon-traits first"],
    });
  });

  it("refuses a collection that is not scraped yet", async () => {
    const report = await runScrape({
      dataDir,
      source: new FixtureSource(FIXTURES_DIR),
      http: null,
      only: ["armors"],
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
        "armors is not scraped yet (available: boosters, passives, weapon-traits, weapons, stratagems)",
      ],
    });
  });
});
