import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrillSource, drillFetch, drillStore } from "../src/drill.ts";
import { HttpClient } from "../src/http/client.ts";
import type { ImageBackend } from "../src/images/attach.ts";
import { silentLogger } from "../src/log.ts";
import { runScrape } from "../src/run.ts";
import { FixtureSource, type WikiSource } from "../src/source.ts";
import { FIXTURES_DIR } from "./fixtures.ts";
import { fakeBackend } from "./images/fake-backend.ts";

// The drills of plan phase 7: each one fails the run it is meant to fail and leaves the published
// dataset untouched. The real rehearsal runs on Actions; this proves the wiring offline, over a
// copy of the published `data/`, which is what a drill run on a branch works on too.

const repoData = join(import.meta.dirname, "..", "..", "..", "data");

let dir: string;
let dataDir: string;

async function readTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      tree[relative(root, path)] = await readFile(path, "utf8");
    }
  }
  return tree;
}

const run = (
  source: WikiSource = new FixtureSource(FIXTURES_DIR),
  images: ImageBackend | null = fakeBackend(),
) =>
  runScrape({
    dataDir,
    source,
    http: null,
    images,
    only: ["boosters"],
    allowDrop: false,
    fullRefresh: false,
    baseUrl: "https://helldivers.wiki.gg",
    userAgent: "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)",
    now: () => new Date("2026-09-17T21:07:00Z"),
    logger: silentLogger,
  });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hd2-drill-"));
  dataDir = join(dir, "data");
  await cp(repoData, dataDir, { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SCRAPER_DRILL", () => {
  it.each(["parser-broken", "count-drop", "robots-changed"] as const)(
    "%s fails the run and publishes nothing",
    async (kind) => {
      const published = await readTree(join(dataDir, "v1"));
      const report = await run(new DrillSource(new FixtureSource(FIXTURES_DIR), kind));
      expect(report.failure?.kind).toBe(kind);
      expect(report.changed).toBe(false);
      expect(await readTree(join(dataDir, "v1"))).toEqual(published);
    },
  );

  it("images fails when the bucket refuses the uploads", async () => {
    // Without the manifest every picture is uploaded again, which is what the drill refuses.
    await rm(join(dataDir, "v1", "reports", "images.json"));
    const published = await readTree(join(dataDir, "v1"));
    const backend = fakeBackend();
    const report = await run(new FixtureSource(FIXTURES_DIR), {
      ...backend,
      store: drillStore(backend.store),
    });
    expect(report.failure?.kind).toBe("images");
    expect(report.failure?.messages.join(" ")).toContain("drill: upload refused");
    expect(await readTree(join(dataDir, "v1"))).toEqual(published);
  });

  it("blocked stops the client after three refusals in a row", async () => {
    const http = new HttpClient({
      baseUrl: "https://helldivers.wiki.gg",
      userAgent: "test",
      pacing: { delayMs: 0, jitterMs: 0, pauseEvery: 1_000, pauseMs: 0 },
      cache: null,
      fullRefresh: false,
      retryDelaysMs: [0, 0, 0],
      fetch: drillFetch(),
    });
    await expect(http.get("/wiki/Boosters")).rejects.toThrow(
      /blocked while fetching .*3 consecutive/,
    );
    expect(http.stats.requests).toBe(3);
  });
});
