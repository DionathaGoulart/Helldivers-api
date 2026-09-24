import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  type ArmorSet,
  type Collection,
  Collection as Collections,
  type Image,
  validateDataset,
} from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import * as cheerio from "cheerio";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PIPELINES, selectPipelines } from "../src/collections/index.ts";
import type { ImageBackend } from "../src/images/attach.ts";
import { silentLogger } from "../src/log.ts";
import type { RunReport } from "../src/publish/report.ts";
import { runScrape } from "../src/run.ts";
import { FixtureSource, type WikiPage, type WikiSource } from "../src/source.ts";
import { FIXTURES_DIR } from "./fixtures.ts";
import { fakeBackend } from "./images/fake-backend.ts";

// E2E offline (arch §11): fixtures → data/v1 in a temporary DATA_DIR.

const repoOverrides = join(import.meta.dirname, "..", "..", "..", "data", "overrides");
const INPUT_OVERRIDES = [
  "warbond-aliases.json",
  "source-labels.json",
  "trait-aliases.json",
  "armor-sets.json",
];

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

/** Fixture source whose Equipment Traits page tables TD-110 Maelstrom under "Anti Tank" (2026-09-23). */
class MisspelledTraitSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.#inner.page(title);
    if (title !== "Equipment Traits") {
      return page;
    }
    const $ = cheerio.load(page.html);
    $("#All_Traits")
      .closest(".mw-heading, h2")
      .nextAll("ol")
      .first()
      .append("<li>Anti Tank - 1 unique gear items</li>");
    const antiTank = $("h3:has(#Anti-Tank), .mw-heading:has(#Anti-Tank)").first();
    antiTank
      .nextAll("table.wikitable")
      .first()
      .after(
        `<h3><span class="mw-headline" id="Anti_Tank">Anti Tank</span></h3>
       <table class="wikitable"><tbody>
         <tr><th>Page Name</th><th>Name</th><th>Type</th><th>Trait</th></tr>
         <tr><td><a href="/wiki/TD-110_Maelstrom" title="TD-110 Maelstrom">TD-110 Maelstrom</a></td>
             <td>TD-110 Maelstrom</td><td>Stratagem</td><td>Anti Tank</td></tr>
       </tbody></table>`,
      );
    return { ...page, html: $.html() };
  }
}

/** Fixture source on which one page title redirects to another fixture. */
class RenamedSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);

  constructor(readonly redirects: Readonly<Record<string, string>>) {}

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  page(title: string): Promise<WikiPage> {
    return this.#inner.page(this.redirects[title] ?? title);
  }
}

/** Fixture source whose Helldivers Mobilize tables swap two boosters' names, not their prices,
 *  between pages 4 and 6; the icon grids stay right (Ironclad Democracy, 2026-09-24). */
class SwappedRowsSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.#inner.page(title);
    if (!title.startsWith("Helldivers Mobilize")) {
      return page;
    }
    const $ = cheerio.load(page.html);
    const row = (name: string) =>
      $("table.wikitable tr").filter((_, tr) => $(tr).children("td").eq(1).text().trim() === name);
    const [vitality, uav] = [row("Vitality Enhancement"), row("UAV Recon Booster")];
    for (const cell of [0, 1]) {
      const html = vitality.children("td").eq(cell).html() ?? "";
      vitality
        .children("td")
        .eq(cell)
        .html(uav.children("td").eq(cell).html() ?? "");
      uav.children("td").eq(cell).html(html);
    }
    return { ...page, html: $.html() };
  }
}

/** Fixture source whose Stratagems index lists the announced TD-110 Maelstrom (2026-09-19). */
class AnnouncedSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);

  /** `announced`: as the wiki has it. `released`: code and category as they will read on launch.
   *  `codeless`: released but still without a code, which has to fail. */
  constructor(readonly state: "announced" | "released" | "codeless" = "announced") {}

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.#inner.page(title);
    if (title === "TD-110 Maelstrom") {
      return this.state === "announced"
        ? page
        : { ...page, html: page.html.replaceAll(/Unreleased[ _]Content/g, "Tanks") };
    }
    if (title !== "Stratagems") {
      return page;
    }
    const arrow = (direction: string) =>
      `<span class="Stratagemcodeicon icon-outline"><img alt="Stratagem Arrow ${direction}.svg" src="/images/Stratagem_Arrow_${direction}.svg?de4f99" width="512" height="512" data-file-width="512" data-file-height="512"></span>`;
    const code =
      this.state === "released"
        ? ["Left", "Down", "Right", "Up", "Up"].map(arrow).join("")
        : '<span class="Stratagemcodeicon">UNKNOWN</span>';
    const source =
      this.state === "announced"
        ? '<a href="/wiki/Super_Destroyer" title="Super Destroyer">Super Destroyer</a>'
        : "Bridge";
    const cooldown = this.state === "released" ? "600s" : "Unknown";
    const $ = cheerio.load(page.html);
    $("details")
      .filter((_, details) => $(details).children("summary").text().trim() === "Vehicles")
      .find("table.wikitable tr")
      .first()
      .after(
        `<tr><td><a href="/wiki/File:Tank_Stratagem_Fallback_Icon_Background.svg" class="image"><img alt="Tank Stratagem Fallback Icon Background.svg" src="/images/Tank_Stratagem_Fallback_Icon_Background.svg?cbf970" width="50" height="50" data-file-width="512" data-file-height="512"></a></td><td><a href="/wiki/TD-110_Maelstrom" title="TD-110 Maelstrom">TD-110 Maelstrom</a></td><td>${code}</td><td>${cooldown}</td><td>N/A</td><td>N/A</td><td>${source}</td></tr>`,
      );
    return { ...page, html: $.html() };
  }
}

/** Fixture source on which some wiki files were uploaded again: their version suffix changed. */
class ReuploadedSource implements WikiSource {
  readonly offline = true;
  readonly #inner = new FixtureSource(FIXTURES_DIR);
  readonly #pattern: RegExp;

  constructor(files: readonly string[]) {
    const names = files.map((file) =>
      file.replaceAll("'", "%27").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    this.#pattern = new RegExp(
      `(/images/(?:thumb/)?(?:${names.join("|")})(?:/[^"?\\s]*)?\\?)([a-f0-9]+)`,
      "g",
    );
  }

  static version(old: string): string {
    return [...old].map((digit) => (15 - Number.parseInt(digit, 16)).toString(16)).join("");
  }

  robotsTxt(): Promise<string> {
    return this.#inner.robotsTxt();
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.#inner.page(title);
    const html = page.html.replace(
      this.#pattern,
      (_match, head: string, version: string) => `${head}${ReuploadedSource.version(version)}`,
    );
    return { ...page, html };
  }
}

async function emptyDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hd2-run-"));
  await mkdir(join(root, "data", "overrides"), { recursive: true });
  for (const file of INPUT_OVERRIDES) {
    await copyFile(join(repoOverrides, file), join(root, "data", "overrides", file));
  }
  return root;
}

let dir: string;
let dataDir: string;

beforeEach(async () => {
  dir = await emptyDataDir();
  dataDir = join(dir, "data");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = (
  at: string,
  source: WikiSource = new FixtureSource(FIXTURES_DIR),
  allowDrop = false,
  only: Collection[] | null = null,
  into = dataDir,
  images: ImageBackend | null = fakeBackend(),
) =>
  runScrape({
    dataDir: into,
    source,
    http: null,
    images,
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

// A full run reads ~500 fixture pages, so it runs once: the tests that change a published
// dataset start from a copy of it (warbond sources need the warbonds collection).
let baselineDir: string;
let baseline: RunReport;

beforeAll(async () => {
  baselineDir = await emptyDataDir();
  baseline = await run(
    "2026-09-15T21:07:00.123Z",
    undefined,
    false,
    null,
    join(baselineDir, "data"),
  );
}, 300_000);
afterAll(async () => {
  await rm(baselineDir, { recursive: true, force: true });
});

const fromBaseline = () => cp(join(baselineDir, "data"), dataDir, { recursive: true });

/** Image keys with their content hash replaced: the examples carry placeholder hashes. */
const hashless = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value), (key, inner) =>
    key === "url" && typeof inner === "string"
      ? inner.replace(/\.[a-f0-9]{8}\.webp$/, ".<hash8>.webp")
      : inner,
  );

describe("pnpm scrape --offline", { timeout: 300_000 }, () => {
  it("publishes every collection equal to the golden snapshots", async () => {
    const report = baseline;
    const dataDir = join(baselineDir, "data");

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
      { collection: "player-cards", before: 0, after: 76 },
      { collection: "emotes", before: 0, after: 48 },
      { collection: "patterns", before: 0, after: 27 },
      { collection: "titles", before: 0, after: 56 },
      { collection: "warbonds", before: 0, after: 25 },
      { collection: "armor-sets", before: 0, after: 109 },
    ]);
    // Unreleased Ironclad Democracy items (their passive, costs, stats and descriptions, the two
    // player cards missing from the Cosmetics grid, the cosmetics and boosters only its warbond
    // page lists), the Source-less CQC-73 Entrenchment Tool, one cape page without an Armory
    // quote, an emote only the Exo Experts page lists, page tables that do not add up and the
    // traits of unreleased weapons the Equipment Traits tables do not list yet (rule 7).
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
      'warbonds/exo-experts: "Thumb of Approval" (Emote) matches no entity',
      'warbonds/ironclad-democracy: "Verdant Camouflage" (Pattern) matches no entity',
      'warbonds/ironclad-democracy: "Integrated Extinguishers" (Booster) matches no entity',
      'warbonds/ironclad-democracy: "Glacial Polymer" (Pattern) matches no entity',
      'warbonds/ironclad-democracy: "Helmet Durability Check" (Emote) matches no entity',
      'warbonds/ironclad-democracy: "Surplus EAT Allocation" (Booster) matches no entity',
      'warbonds/ironclad-democracy: "Executive Onyx" (Pattern) matches no entity',
      'warbonds/ironclad-democracy: "Treadhead" (Title) matches no entity',
      "warbonds/ironclad-democracy: 20 item costs not announced",
      "warbonds/entrenched-division: page tables add up to 892 medals, All Items Unlocked says 888",
      "weapons/ar-11-arbitrator: traits not listed on Equipment Traits: rounds-reload",
      "weapons/g-60-anti-tank-seeker: traits not listed on Equipment Traits: explosive, guided",
      "weapons/g-8-immolation: traits not listed on Equipment Traits: incendiary, explosive",
      "weapons/gl-15-evictor: traits not listed on Equipment Traits: explosive, rounds-reload",
      "weapons/p-34-breacher: traits not listed on Equipment Traits: explosive, one-handed",
      "stratagems/tactical-video-camera: the wiki shows Placeholder.png, a stand-in; no image",
      // The two unreleased player cards have neither a Player Card picture nor a Cosmetics box.
      "player-cards/shroud-of-the-juggernaut: no image on the wiki",
      "player-cards/standard-of-rapid-evacuation: no image on the wiki",
    ]);
    expect(report.changes.every((change) => change.kind === "added")).toBe(true);
    expect(report.dataVersion).toMatch(/^2026-09-15\.[a-f0-9]{8}$/);
    // Every picture uploaded once; 11 wiki files serve two entities (shared passive icons…).
    expect(report.images).toEqual({
      requested: 849,
      reused: 0,
      fetched: 838,
      uploaded: 849,
      failed: 0,
      deleted: 0,
      images: 849,
      orphans: 0,
      bytes: expect.any(Number),
    });

    const { files, issues } = await readDatasetFiles(join(dataDir, "v1"));
    expect(issues).toEqual([]);
    expect(validateDataset(files)).toEqual([]);
    // meta + changelog + conflicts + images, then one list and one file per entity per collection.
    expect(files.size).toBe(
      4 +
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
        (1 + 56) +
        (1 + 25),
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
      "player-cards",
      "emotes",
      "patterns",
      "titles",
      "warbonds",
      "armor-sets",
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

    // AR-23 Liberator equals arch §5.4, image key hash aside.
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
    expect(hashless(rest)).toEqual(hashless({ ...example, statsRaw: undefined }));
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

    // Orbital Precision Strike equals arch §5.4 (image hash aside); table rows of `statsRaw` are
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
    expect(hashless(opsRest)).toEqual(
      hashless({ ...ops.example, statsRaw: undefined, shipModules: undefined, attacks: undefined }),
    );
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

    // TG-8 Sharpshooter armor and helmet equal arch §5.4 (image hash aside). The helmet keeps its
    // page cost (30): the warbond table's 39 loses by rule 1 (below).
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
      expect(
        hashless((files.get(`${collection}/tg-8-sharpshooter.json`) as { data: unknown }).data),
      ).toEqual(hashless(example));
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
    // Capes: the page gives no page number, so the warbond table does (rule 3); the set comes
    // from the same warbond page (rule 6), the player card of the same page from rule 9.
    expect(files.get("capes/city-fighters-resolve.json")).toMatchObject({
      data: {
        description: expect.stringMatching(/^The Helldivers are all that stand between/),
        setIds: ["tg-122-demo-trooper"],
        playerCardId: "city-fighters-resolve",
        source: {
          warbondId: "castellans-creed",
          page: 2,
          cost: { currency: "medals", amount: 25 },
        },
      },
    });
    // Rule 6: TG-8 Sharpshooter equals arch §5.4 (warbond page), O-44 Bonded Pilot takes the cape
    // of its Superstore tab; 13 sets from the Superstore and 61 from warbond pages.
    expect(files.get("armor-sets/tg-8-sharpshooter.json")).toEqual({
      meta: expect.anything(),
      data: JSON.parse(
        await readFile(
          join(
            import.meta.dirname,
            "../../schemas/test/examples/armor-sets.tg-8-sharpshooter.json",
          ),
          "utf8",
        ),
      ),
    });
    expect(files.get("armor-sets/o-44-bonded-pilot.json")).toMatchObject({
      data: {
        capeId: "diagram-of-the-noblest-payload",
        capeLink: {
          method: "superstore_set",
          evidence:
            "Superstore page 1 (Exo Experts) stocks exactly one armor (O-44 Bonded Pilot) and one cape (Diagram of the Noblest Payload)",
        },
      },
    });
    const methods = (files.get("armor-sets.json") as { data: ArmorSet[] }).data.map(
      (set) => set.capeLink?.method ?? null,
    );
    expect(methods.filter((method) => method === "superstore_set")).toHaveLength(13);
    expect(methods.filter((method) => method === "warbond_page")).toHaveLength(61);
    expect(files.get("armor-sets/sa-12-servo-assisted.json")).toMatchObject({
      data: { capeId: null, capeLink: null }, // two capes on Steeled Veterans page 2
    });
    expect(files.get("passives/blunt-force-mitigation.json")).toMatchObject({
      data: { armorIds: ["bfm-16-tanker", "bfm-220-ironclad"] },
    });

    // Cosmetics equal arch §5.4 (image hashes aside). The Castellans Green page lead has since
    // been split from its acquisition paragraph, and the Sergeant row links its own page.
    const readExample = async (name: string) =>
      JSON.parse(
        await readFile(
          join(import.meta.dirname, `../../schemas/test/examples/${name}.json`),
          "utf8",
        ),
      );
    for (const name of [
      "player-cards.city-fighters-resolve",
      "emotes.clapping",
      "patterns.arctic",
      "titles.viper-commando",
      "titles.sergeant",
    ]) {
      const [collection, id] = name.split(".");
      expect(
        hashless((files.get(`${collection}/${id}.json`) as { data: unknown }).data),
        name,
      ).toEqual(hashless(await readExample(name)));
    }
    expect(
      hashless((files.get("patterns/castellans-green.json") as { data: unknown }).data),
    ).toEqual(
      hashless({
        ...(await readExample("patterns.castellans-green")),
        description: "Castellans Green patterns are selectable wraps for your various vehicles.",
      }),
    );
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
          image: expect.objectContaining({
            url: expect.stringMatching(new RegExp(`^/images/v1/patterns/standard-${target}\\.`)),
          }),
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

    // Castellan's Creed equals arch §5.4 (image hash aside), the TG-8 helmet at 30 (rule 1).
    expect(
      hashless((files.get("warbonds/castellans-creed.json") as { data: unknown }).data),
    ).toEqual(hashless(await readExample("warbonds.castellans-creed")));
    // Rows linking a redirect (LAS-16 Trident → LAS-13 Trident) or with curly quotes resolve.
    const refs = (id: string) =>
      (
        files.get(`warbonds/${id}.json`) as { data: { pages: { items: { ref: unknown }[] }[] } }
      ).data.pages.flatMap((page) => page.items.map((item) => item.ref));
    expect(refs("siege-breakers")).toContainEqual({
      collection: "weapons",
      id: "las-13-trident",
      variant: null,
    });
    expect(refs("chemical-agents")).toContainEqual({
      collection: "stratagems",
      id: "ax-tx-13-dog-breath",
      variant: null,
    });
    expect(files.get("warbonds/helldivers-mobilize.json")).toMatchObject({
      data: {
        name: "Helldivers Mobilize!",
        aliases: ["Helldivers Mobilize"],
        type: "standard",
        cost: { currency: "super_credits", amount: 0 },
        superCreditsClaimable: 750,
        medalsAllItems: 2015,
      },
    });
    expect(files.get("warbonds/obedient-democracy-support-troopers.json")).toMatchObject({
      data: { aliases: ["Halo: ODST"] },
    });
    expect(files.get("warbonds/ironclad-democracy.json")).toMatchObject({
      data: { releaseDate: "2026-09-22", medalsAllPages: null, medalsAllItems: null },
    });
    // Rule 1: Control Group's tables add up only with Protect Eardrums at 55, so the emote takes it.
    expect(files.get("emotes/protect-eardrums.json")).toMatchObject({
      data: { source: { warbondId: "control-group", page: 3, cost: { amount: 55 } } },
    });

    // Civilian weapons: SG-88 equals arch §5.4 except the image hash, the table-keyed `statsRaw` and
    // the maintenance flag the audit did not capture; the CQC-72 page is named Trench Shovel in
    // game and mentions CQC-73's warbond.
    const sg88 = await readExample("weapons.sg-88-break-action-shotgun");
    const { statsRaw: sg88Raw, ...sg88Rest } = (
      files.get("weapons/sg-88-break-action-shotgun.json") as { data: Record<string, unknown> }
    ).data;
    expect(hashless(sg88Rest)).toEqual(
      hashless({
        ...sg88,
        statsRaw: undefined,
        wiki: { ...sg88.wiki, flags: ["potentially_outdated"] },
      }),
    );
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
      files.get("reports/conflicts.json") as {
        conflicts: { collection: string; id: string; field: string }[];
      }
    ).conflicts;
    expect(conflicts.filter((conflict) => conflict.collection === "warbonds")).toEqual([
      {
        collection: "warbonds",
        id: "castellans-creed",
        field: "pages[0].items[2].cost",
        rule: 1,
        chosen: { currency: "medals", amount: 30 },
        candidates: [
          {
            page: "https://helldivers.wiki.gg/wiki/Castellan's_Creed_Legendary_Warbond",
            location: "Page 1 › TG-8 Sharpshooter",
            value: { currency: "medals", amount: 39 },
          },
          {
            page: "https://helldivers.wiki.gg/wiki/TG-8_Sharpshooter",
            location: "helmets/tg-8-sharpshooter › source",
            value: { currency: "medals", amount: 30 },
          },
        ],
      },
      {
        collection: "warbonds",
        id: "control-group",
        field: "pages[2].items[3].cost",
        rule: 1,
        chosen: { currency: "medals", amount: 55 },
        candidates: [
          {
            page: "https://helldivers.wiki.gg/wiki/Control_Group_Premium_Warbond",
            location: "Page 3 › Protect Eardrums",
            value: { currency: "medals", amount: 55 },
          },
          {
            page: "https://helldivers.wiki.gg/wiki/Protect_Eardrums",
            location: "emotes/protect-eardrums › source",
            value: { currency: "medals", amount: 50 },
          },
        ],
      },
      {
        collection: "warbonds",
        id: "entrenched-division",
        field: "medalsAllItems",
        rule: 1,
        chosen: 888,
        candidates: [
          {
            page: "https://helldivers.wiki.gg/wiki/Entrenched_Division_Premium_Warbond",
            location: "infobox › All Items Unlocked",
            value: 888,
          },
          {
            page: "https://helldivers.wiki.gg/wiki/Entrenched_Division_Premium_Warbond",
            location: "page tables › sum",
            value: 892,
          },
        ],
      },
    ]);
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
      ["warbonds", 25],
    ] as const) {
      expect(Object.keys(lock[collection]), collection).toHaveLength(count);
    }
    expect(lock.capes["Cloak of Posterity's Gratitude"]).toBe("cloak-of-posteritys-gratitude");
    expect(lock.patterns["Castellans Green Pattern"]).toBe("castellans-green");
    expect(lock.patterns["Cosmetics#Patterns/Arctic"]).toBe("arctic");
    expect(lock.titles.Redacted).toBe("redacted");
    expect(lock.warbonds["Helldivers Mobilize Warbond"]).toBe("helldivers-mobilize");
  });

  it("marks the unreleased Ironclad Democracy items upcoming", async () => {
    const upcoming: Record<string, string[]> = {};
    for (const collection of Collections.options) {
      const list = JSON.parse(
        await readFile(join(baselineDir, "data", "v1", `${collection}.json`), "utf8"),
      ) as { data: { id: string; upcoming: boolean }[] };
      const ids = list.data.filter((entity) => entity.upcoming).map((entity) => entity.id);
      if (ids.length > 0) upcoming[collection] = ids;
    }
    expect(upcoming).toEqual({
      warbonds: ["ironclad-democracy"],
      weapons: [
        "ar-11-arbitrator",
        "g-60-anti-tank-seeker",
        "g-8-immolation",
        "gl-15-evictor",
        "p-34-breacher",
      ],
      armors: ["bfm-16-tanker", "bfm-220-ironclad"],
      helmets: ["bfm-16-tanker", "bfm-220-ironclad"],
      capes: ["shroud-of-the-juggernaut", "standard-of-rapid-evacuation"],
      "armor-sets": ["bfm-16-tanker", "bfm-220-ironclad"],
      "player-cards": ["shroud-of-the-juggernaut", "standard-of-rapid-evacuation"],
    });
  });

  it("changes nothing on a second run with the same pages", async () => {
    await fromBaseline();
    const before = await readTree(dataDir);
    const images = fakeBackend();

    const report = await run("2026-09-16T21:07:00Z", undefined, false, null, dataDir, images);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    // No wiki image request and no B2 call: every picture is in the manifest.
    expect(report.images).toMatchObject({ requested: 849, reused: 849, fetched: 0, uploaded: 0 });
    expect(images.fetched).toEqual([]);
    expect(images.store.calls).toEqual([]);
    expect(await readTree(dataDir)).toEqual(before);
  });

  describe("images", () => {
    const ICON = "Hellpod_Space_Optimization_Booster_Icon.svg";
    const readJson = async (path: string) =>
      JSON.parse(await readFile(join(dataDir, "v1", path), "utf8"));
    const boosterImage = async () =>
      (await readJson("boosters/hellpod-space-optimization.json")).data.image;

    it("downloads and uploads only a picture whose wiki file has a new version", async () => {
      await fromBaseline();
      const old = await boosterImage();
      const images = fakeBackend();

      const report = await run(
        "2026-09-16T21:07:00Z",
        new ReuploadedSource([ICON]),
        false,
        ["boosters"],
        dataDir,
        images,
      );
      // A new key for the same wiki file is not a change for clients, but a new data version.
      expect(report).toMatchObject({ ok: true, changed: true, changes: [] });
      expect(report.images).toMatchObject({
        requested: 18,
        reused: 17,
        fetched: 1,
        uploaded: 1,
        orphans: 1,
      });
      const version = ReuploadedSource.version("7aa15a");
      expect(images.fetched).toEqual([`/images/${ICON}?${version}`]);
      const image = await boosterImage();
      expect(image).toMatchObject({ width: 256, height: 256, wikiFile: ICON });
      expect(image.url).not.toBe(old.url);
      expect(images.store.calls).toEqual([
        `HEAD ${image.url.slice(1)}`,
        `PUT ${image.url.slice(1)}`,
      ]);
      const manifest = await readJson("reports/images.json");
      expect(manifest.images).toContainEqual({
        ...image,
        version,
        rendition: "icon",
        bytes: expect.any(Number),
      });
      expect(manifest.orphans).toEqual([{ url: old.url, since: "2026-09-16" }]);
    });

    it("deletes a superseded key from B2 30 days after it left the manifest", async () => {
      await fromBaseline();
      const old = await boosterImage();
      const source = new ReuploadedSource([ICON]);
      await run("2026-09-16T21:07:00Z", source, false, ["boosters"], dataDir, fakeBackend());

      const early = fakeBackend();
      const day29 = await run("2026-10-15T21:07:00Z", source, false, ["boosters"], dataDir, early);
      expect(day29).toMatchObject({ ok: true, changed: false });
      expect(early.store.calls).toEqual([]);

      const due = fakeBackend();
      const day30 = await run("2026-10-16T21:07:00Z", source, false, ["boosters"], dataDir, due);
      expect(day30).toMatchObject({ ok: true, changed: true, changes: [] });
      expect(day30.images).toMatchObject({ deleted: 1, orphans: 0 });
      expect(due.store.calls).toEqual([`DELETE ${old.url.slice(1)}`]);
      expect((await readJson("reports/images.json")).orphans).toEqual([]);
    });

    it("reuses the manifest offline and keeps the published image of a changed picture", async () => {
      await fromBaseline();
      const before = await readTree(dataDir);

      const report = await run(
        "2026-09-16T21:07:00Z",
        new ReuploadedSource([ICON]),
        false,
        ["boosters"],
        dataDir,
        null,
      );
      expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
      expect(report.images).toMatchObject({ requested: 18, reused: 17, fetched: 0, uploaded: 0 });
      expect(report.warnings).toContain(
        "images: 1 of 18 pictures need a download, which offline runs skip: published images are kept, new entities get none",
      );
      expect(await readTree(dataDir)).toEqual(before);
    });

    it("keeps published images when up to 5 % of pictures fail and fails above that", async () => {
      await fromBaseline();
      const weapons = (await readJson("weapons.json")).data as { id: string; image: Image }[];
      const source = new ReuploadedSource(weapons.map((weapon) => weapon.image.wikiFile));
      const broken = weapons.slice(0, 6);
      const before = await readTree(dataDir);

      // 6 of 104 (5.8 %): 4 downloads and 2 uploads fail.
      const failing = (count: number) => {
        const images = fakeBackend((path) =>
          broken
            .slice(0, Math.min(count, 4))
            .some((weapon) => path.includes(weapon.image.wikiFile)),
        );
        const uploads = broken.slice(4, count).map((weapon) => `images/v1/weapons/${weapon.id}.`);
        images.store.failPut = (key) => uploads.some((prefix) => key.startsWith(prefix));
        return images;
      };
      const failed = await run(
        "2026-09-16T21:07:00Z",
        source,
        false,
        ["weapons"],
        dataDir,
        failing(6),
      );
      expect(failed.failure?.kind).toBe("images");
      expect(failed.failure?.messages[0]).toBe("6 images failed");
      expect(await readTree(dataDir)).toEqual(before);

      // 5 of 104 (4.8 %): published, those five keep their published image.
      const report = await run(
        "2026-09-16T21:07:00Z",
        source,
        false,
        ["weapons"],
        dataDir,
        failing(5),
      );
      expect(report).toMatchObject({ ok: true, changed: true, changes: [] });
      expect(report.images).toMatchObject({ requested: 104, failed: 5 });
      for (const weapon of broken.slice(0, 5)) {
        expect((await readJson(`weapons/${weapon.id}.json`)).data.image).toEqual(weapon.image);
        expect(report.warnings).toContainEqual(
          expect.stringMatching(
            new RegExp(
              `^weapons/${weapon.id}: image .* failed \\(.*\\); kept the published image$`,
            ),
          ),
        );
      }
    });
  });

  it("fails with count-drop when 3 of 18 rows disappear and leaves data untouched", async () => {
    await fromBaseline();
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

  // A removal needs the warbonds too: their rows would still refer to the removed booster.
  it("publishes a removal when 1 of 18 rows disappears", async () => {
    await fromBaseline();
    const report = await run("2026-09-16T21:07:00Z", new DroppingSource(["Stun Pods"]));

    expect(report).toMatchObject({ ok: true, changed: true });
    expect(report.warnings.filter((warning) => !baseline.warnings.includes(warning))).toEqual([
      'warbonds/force-of-law: "Stun Pods" (Booster) matches no entity',
    ]);
    expect(report.changes).toEqual([
      {
        collection: "warbonds",
        id: "force-of-law",
        kind: "changed",
        paths: ["pages[1].items[1].ref"],
      },
      { collection: "boosters", id: "stun-pods", kind: "removed" },
    ]);
    const changelog = JSON.parse(await readFile(join(dataDir, "v1", "changelog.json"), "utf8"));
    expect(changelog.data.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-09-16",
      "2026-09-15",
    ]);
    // Its image is no longer referenced: an orphan, deleted from B2 after 30 days.
    const manifest = JSON.parse(
      await readFile(join(dataDir, "v1", "reports", "images.json"), "utf8"),
    );
    expect(manifest.orphans).toEqual([
      { url: expect.stringMatching(/^\/images\/v1\/boosters\/stun-pods\./), since: "2026-09-16" },
    ]);
  });

  it("keeps the cape ⇄ player card pairs on a capes-only run", async () => {
    await fromBaseline();
    const before = await readTree(dataDir);

    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["capes"]);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("publishes an announced stratagem as upcoming, without a code yet", async () => {
    await fromBaseline();

    const report = await run("2026-09-16T21:07:00Z", new AnnouncedSource(), false, ["stratagems"]);
    expect(report).toMatchObject({ ok: true, failure: null });
    expect(report.changes).toContainEqual({
      collection: "stratagems",
      id: "td-110-maelstrom",
      kind: "added",
    });
    const file = JSON.parse(
      await readFile(join(dataDir, "v1", "stratagems", "td-110-maelstrom.json"), "utf8"),
    );
    expect(file.data).toMatchObject({
      name: "TD-110 Maelstrom",
      upcoming: true,
      kind: "vehicle",
      code: [],
      cooldownS: null,
      unlockLevel: null,
      source: { type: "other", label: "Super Destroyer" },
    });
  });

  it("updates the same stratagem when the wiki releases it", async () => {
    await fromBaseline();
    await run("2026-09-16T21:07:00Z", new AnnouncedSource(), false, ["stratagems"]);
    const idLock = JSON.parse(await readFile(join(dataDir, "overrides", "ids.lock.json"), "utf8"));

    const report = await run("2026-09-17T21:07:00Z", new AnnouncedSource("released"), false, [
      "stratagems",
    ]);
    expect(report).toMatchObject({ ok: true, failure: null });
    expect(report.changes).toEqual([
      {
        collection: "stratagems",
        id: "td-110-maelstrom",
        kind: "changed",
        paths: ["upcoming", "category", "code", "source.type", "source.label"],
      },
    ]);
    const file = JSON.parse(
      await readFile(join(dataDir, "v1", "stratagems", "td-110-maelstrom.json"), "utf8"),
    );
    expect(file.data).toMatchObject({
      id: "td-110-maelstrom",
      upcoming: false,
      code: ["left", "down", "right", "up", "up"],
      cooldownS: null, // the index Base Cooldown column is not a source for it
      category: "bridge",
      source: { type: "requisition", label: "Bridge" },
    });
    expect(
      JSON.parse(await readFile(join(dataDir, "overrides", "ids.lock.json"), "utf8")).stratagems[
        "TD-110 Maelstrom"
      ],
    ).toBe(idLock.stratagems["TD-110 Maelstrom"]);
  });

  it("still fails on a released stratagem without a code", async () => {
    await fromBaseline();

    const report = await run("2026-09-16T21:07:00Z", new AnnouncedSource("codeless"), false, [
      "stratagems",
    ]);
    expect(report.failure).toEqual({
      kind: "parser-broken",
      collection: "stratagems",
      messages: [expect.stringContaining("a released stratagem needs a code")],
    });
  });

  it("lets data/overrides/armor-sets.json set or remove a cape", async () => {
    await fromBaseline();
    await writeFile(
      join(dataDir, "overrides", "armor-sets.json"),
      JSON.stringify({
        "tg-8-sharpshooter": { capeId: null, evidence: "not sold as a set" },
        "b-01-tactical": { capeId: "camo-cloak", evidence: "worn together in the trailer" },
      }),
    );

    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["armor-sets"]);
    expect(report.failure).toBeNull();
    expect(report.changes).toEqual([
      { collection: "capes", id: "camo-cloak", kind: "changed", paths: ["setIds[0]"] },
      {
        collection: "armor-sets",
        id: "b-01-tactical",
        kind: "changed",
        paths: ["capeId", "capeLink"],
      },
      {
        collection: "armor-sets",
        id: "tg-8-sharpshooter",
        kind: "changed",
        paths: ["capeId", "capeLink"],
      },
    ]);
    const set = (id: string) =>
      readFile(join(dataDir, "v1", "armor-sets", `${id}.json`), "utf8").then(
        (text) => JSON.parse(text).data,
      );
    expect(await set("b-01-tactical")).toMatchObject({
      capeId: "camo-cloak",
      capeLink: { method: "override", evidence: "worn together in the trailer" },
    });
    expect(await set("tg-8-sharpshooter")).toMatchObject({ capeId: null, capeLink: null });
    const cloak = JSON.parse(
      await readFile(join(dataDir, "v1", "capes", "camo-cloak.json"), "utf8"),
    );
    expect(cloak.data.setIds).toEqual(["b-01-tactical"]);
  });

  it("fails on an armor set override that names nothing", async () => {
    await fromBaseline();
    await writeFile(
      join(dataDir, "overrides", "armor-sets.json"),
      JSON.stringify({ "tg-9-sharpshooter": { capeId: "camo-cloak", evidence: "typo" } }),
    );
    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["armor-sets"]);
    expect(report.failure).toEqual({
      kind: "error",
      collection: "armor-sets",
      messages: ['data/overrides/armor-sets.json: "tg-9-sharpshooter" is not an armor set'],
    });
  });

  it("keeps the published id of a renamed page", async () => {
    await fromBaseline();
    // Published before the wiki renamed "Hellpod Space Optimisation" to "…Optimization".
    const [OLD, NEW] = ["hellpod-space-optimisation", "hellpod-space-optimization"];
    const v1 = join(dataDir, "v1");
    for (const entry of await readdir(v1, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const path = join(entry.parentPath, entry.name);
        const text = await readFile(path, "utf8");
        await writeFile(
          path,
          text
            .replaceAll(`"id": "${NEW}"`, `"id": "${OLD}"`)
            .replaceAll(`/images/v1/boosters/${NEW}.`, `/images/v1/boosters/${OLD}.`),
        );
      }
    }
    await rename(join(v1, "boosters", `${NEW}.json`), join(v1, "boosters", `${OLD}.json`));
    const lockPath = join(dataDir, "overrides", "ids.lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    delete lock.boosters["Hellpod Space Optimization"];
    lock.boosters["Hellpod Space Optimisation"] = OLD;
    await writeFile(lockPath, JSON.stringify(lock));
    const before = await readTree(v1);

    const source = new RenamedSource({
      "Hellpod Space Optimisation": "Hellpod Space Optimization",
    });
    const report = await run("2026-09-16T21:07:00Z", source, false, ["boosters"]);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(report.warnings).toContain(
      `boosters/${OLD}: "Hellpod Space Optimisation" was renamed to "Hellpod Space Optimization"; the id is kept`,
    );
    expect(await readTree(v1)).toEqual(before);
    const locked = JSON.parse(await readFile(lockPath, "utf8")).boosters;
    expect(locked["Hellpod Space Optimisation"]).toBe(OLD);
    expect(locked["Hellpod Space Optimization"]).toBe(OLD);
  });

  it("keeps rule 1 prices on an emotes-only run", async () => {
    await fromBaseline();
    const before = await readTree(dataDir);

    const report = await run("2026-09-16T21:07:00Z", undefined, false, ["emotes"]);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [] });
    expect(await readTree(dataDir)).toEqual(before);
  });

  it("publishes the right pages when a warbond table swaps two rows its icon grid does not (rule 12)", async () => {
    await fromBaseline();
    const before = await readTree(dataDir);

    const report = await run("2026-09-24T12:00:00Z", new SwappedRowsSource());
    expect(report).toMatchObject({ ok: true, changes: [], failure: null });
    expect(report.warnings.filter((warning) => !baseline.warnings.includes(warning))).toEqual([
      "warbonds/helldivers-mobilize: boosters/uav-recon-booster is on page 6 per its source, page 4 per the table and page 6 per the icon grid; took page 6",
      "warbonds/helldivers-mobilize: boosters/vitality-enhancement is on page 4 per its source, page 6 per the table and page 4 per the icon grid; took page 4",
    ]);
    const after = await readTree(dataDir);
    const warbond = join("v1", "warbonds", "helldivers-mobilize.json");
    expect(JSON.parse(after[warbond] ?? "").data).toEqual(JSON.parse(before[warbond] ?? "").data);
    const conflicts = JSON.parse(after[join("v1", "reports", "conflicts.json")] ?? "");
    expect(
      conflicts.conflicts.filter((conflict: { rule: number }) => conflict.rule === 12),
    ).toMatchObject([
      { id: "helldivers-mobilize", field: "pages[3].items[1]", chosen: 6 },
      { id: "helldivers-mobilize", field: "pages[5].items[1]", chosen: 4 },
    ]);
  });

  it("folds a misspelled trait table into the trait named in data/overrides/trait-aliases.json", async () => {
    await fromBaseline();
    const report = await run("2026-09-23T12:00:00Z", new MisspelledTraitSource(), false, [
      "weapon-traits",
    ]);
    expect(report).toMatchObject({ ok: true, changed: false, changes: [], failure: null });
    expect(report.counts).toEqual([{ collection: "weapon-traits", before: 28, after: 28 }]);
  });

  it("fails on a misspelled trait table that has no alias", async () => {
    await fromBaseline();
    await writeFile(join(dataDir, "overrides", "trait-aliases.json"), "{}");
    const report = await run("2026-09-23T12:00:00Z", new MisspelledTraitSource(), false, [
      "weapon-traits",
    ]);
    expect(report.failure).toEqual({
      kind: "error",
      collection: "weapon-traits",
      messages: [
        'weapon-traits: "Equipment Traits#Anti_Tank" slugifies to "anti-tank", already locked to "Equipment Traits#Anti-Tank"',
      ],
    });
  });

  it("refreshes weapon trait back-references on a weapons-only run", async () => {
    await fromBaseline();
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
    [
      ["armor-sets"],
      "armor-sets need the armors, helmets, capes and warbonds collections: scrape them first",
    ],
    [["player-cards"], "player-cards need the capes collection: scrape capes first"],
  ] as const)("needs the collections %j resolves against", async (only, message) => {
    const report = await run("2026-09-15T21:07:00Z", undefined, false, [...only]);
    expect(report.failure).toEqual({ kind: "error", collection: only[0], messages: [message] });
  });

  it("scrapes every collection, dependencies first", () => {
    expect(PIPELINES.map((pipeline) => pipeline.collection).sort()).toEqual(
      [...Collections.options].sort(),
    );
    expect(
      selectPipelines(["warbonds", "weapons", "weapon-traits"]).map((p) => p.collection),
    ).toEqual(["weapon-traits", "weapons", "warbonds"]);
  });
});
