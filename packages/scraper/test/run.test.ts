import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { validateDataset } from "@hd2/schemas";
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

const run = (at: string, source: WikiSource = new FixtureSource(FIXTURES_DIR), allowDrop = false) =>
  runScrape({
    dataDir,
    source,
    http: null,
    only: null,
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

describe("pnpm scrape --offline", () => {
  it("publishes 18 boosters equal to the golden snapshot", async () => {
    const report = await run("2026-09-15T21:07:00.123Z");

    expect(report.failure).toBeNull();
    expect(report).toMatchObject({ ok: true, changed: true, mode: "offline" });
    expect(report.counts).toEqual([{ collection: "boosters", before: 0, after: 18 }]);
    expect(report.changes.every((change) => change.kind === "added")).toBe(true);
    expect(report.dataVersion).toMatch(/^2026-09-15\.[a-f0-9]{8}$/);

    const { files, issues } = await readDatasetFiles(join(dataDir, "v1"));
    expect(issues).toEqual([]);
    const stubs = JSON.parse(
      await readFile(join(dataDir, "overrides", "warbond-stubs.json"), "utf8"),
    );
    expect(validateDataset(files, { knownIds: { warbonds: new Set(stubs) } })).toEqual([]);
    expect(files.size).toBe(3 + 18);
    expect(files.get("meta.json")).toMatchObject({ generatedAt: "2026-09-15T21:07:00Z" });

    const boosters = (files.get("boosters.json") as { data: unknown[] }).data;
    await expect(`${JSON.stringify(boosters, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/boosters.offline.json",
    );

    const lock = JSON.parse(await readFile(join(dataDir, "overrides", "ids.lock.json"), "utf8"));
    expect(Object.keys(lock.boosters)).toHaveLength(18);
    expect(lock.boosters["Hellpod Space Optimization"]).toBe("hellpod-space-optimization");
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

  it("refuses a collection that is not scraped yet", async () => {
    const report = await runScrape({
      dataDir,
      source: new FixtureSource(FIXTURES_DIR),
      http: null,
      only: ["weapons"],
      allowDrop: false,
      fullRefresh: false,
      baseUrl: "https://helldivers.wiki.gg",
      userAgent: "test",
      now: () => new Date("2026-09-15T21:07:00Z"),
      logger: silentLogger,
    });
    expect(report.failure).toEqual({
      kind: "error",
      messages: ["weapons is not scraped yet (available: boosters)"],
    });
  });
});
