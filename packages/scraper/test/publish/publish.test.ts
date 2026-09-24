import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change, Conflict } from "@hd2/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveEntries,
  buildEntry,
  MAX_CHANGELOG_ENTRIES,
  prependEntry,
} from "../../src/publish/changelog.ts";
import { mergeConflicts } from "../../src/publish/conflicts.ts";
import { diffPaths } from "../../src/publish/diff.ts";
import { checkGuardrails } from "../../src/publish/guardrails.ts";
import { type RunReport, renderCommitMessage, renderSummary } from "../../src/publish/report.ts";

describe("diffPaths", () => {
  it("reports leaf paths, whole arrays that changed length and missing keys", () => {
    const before = { source: { cost: { amount: 15 } }, aliases: ["A"], pages: [{ n: 1 }], gone: 1 };
    const after = {
      source: { cost: { amount: 20 } },
      aliases: ["A", "B"],
      pages: [{ n: 2 }],
      added: 1,
    };
    expect(diffPaths(before, after)).toEqual([
      "source.cost.amount",
      "aliases",
      "pages[0].n",
      "gone",
      "added",
    ]);
  });

  it("ignores an image whose key only changed hash", () => {
    const image = (hash: string, wikiFile = "Icon.svg") => ({
      url: `/images/v1/boosters/stun-pods.${hash}.webp`,
      width: 256,
      height: 256,
      wikiFile,
    });
    expect(diffPaths({ image: image("aaaaaaaa") }, { image: image("bbbbbbbb") })).toEqual([]);
    expect(
      diffPaths({ image: image("aaaaaaaa") }, { image: image("bbbbbbbb", "New.svg") }),
    ).toEqual(["image.url", "image.wikiFile"]);
  });
});

describe("guardrails", () => {
  const counts = (count: number, indexCount = count) => [
    { collection: "boosters" as const, count, indexCount, previous: 18 },
  ];

  it("fails a drop above 10 % (3 of 18) and passes 1 of 18", () => {
    expect(checkGuardrails(counts(15), { allowDrop: false })).toEqual([
      {
        check: "count-drop",
        collection: "boosters",
        message:
          "boosters: 18 → 15 (-16.7 %, limit 10.0 %); rerun with --allow-drop if the wiki removed them",
      },
    ]);
    expect(checkGuardrails(counts(17), { allowDrop: false })).toEqual([]);
    expect(checkGuardrails(counts(15), { allowDrop: true })).toEqual([]);
  });

  it("always fails an empty collection and an index coverage gap", () => {
    expect(checkGuardrails(counts(0), { allowDrop: true }).map((i) => i.check)).toEqual(["empty"]);
    expect(checkGuardrails(counts(18, 19), { allowDrop: false }).map((i) => i.check)).toEqual([
      "index-coverage",
    ]);
  });
});

describe("changelog", () => {
  const changes: Change[] = [
    { collection: "boosters", id: "stun-pods", kind: "added" },
    { collection: "boosters", id: "dead-sprint", kind: "changed", paths: ["effect"] },
  ];

  it("builds entries with matching summary counts", () => {
    expect(buildEntry("2026-09-15.0d15ea5e", "2026-09-15", changes).summary).toEqual({
      added: 1,
      changed: 1,
      removed: 0,
    });
  });

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hd2-changelog-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps 90 entries and archives the rest by year", async () => {
    const old = Array.from({ length: MAX_CHANGELOG_ENTRIES }, (_, i) =>
      buildEntry(
        `2025-12-${String(31 - (i % 28)).padStart(2, "0")}.0000000${i % 10}`,
        "2025-12-01",
        [],
      ),
    );
    const { kept, archived } = prependEntry(
      old,
      buildEntry("2026-01-01.aaaaaaaa", "2026-01-01", changes),
    );
    expect(kept).toHaveLength(MAX_CHANGELOG_ENTRIES);
    expect(kept[0]?.dataVersion).toBe("2026-01-01.aaaaaaaa");
    expect(archived).toEqual([old.at(-1)]);

    await archiveEntries(dir, archived);
    await archiveEntries(dir, archived); // idempotent
    const file = JSON.parse(await readFile(join(dir, "changelog", "2025.json"), "utf8"));
    expect(file).toEqual(archived);
  });
});

describe("conflicts report", () => {
  const conflict = (collection: Conflict["collection"], id: string, field: string): Conflict => ({
    collection,
    id,
    field,
    rule: 2,
    chosen: 10.5,
    candidates: [
      { page: "https://helldivers.wiki.gg/wiki/X", location: "infobox › Recoil", value: 14 },
      { page: "https://helldivers.wiki.gg/wiki/X", location: "X › Recoil", value: 10.5 },
    ],
  });

  it("replaces the conflicts of scraped collections, keeps the rest and sorts them", () => {
    const previous = {
      conflicts: [
        conflict("stratagems", "mg-43", "supportWeapon.recoil"),
        conflict("weapons", "old", "firearm.recoil"),
      ],
    };
    const merged = mergeConflicts(
      previous,
      ["weapons"],
      [
        conflict("weapons", "sg-8-punisher", "firearm.recoil"),
        conflict("weapons", "ar-23-liberator", "firearm.recoil"),
        conflict("weapons", "ar-23-liberator", "firearm.capacity"),
      ],
    );
    expect(merged?.conflicts.map((c) => `${c.collection}/${c.id}:${c.field}`)).toEqual([
      "stratagems/mg-43:supportWeapon.recoil",
      "weapons/ar-23-liberator:firearm.capacity",
      "weapons/ar-23-liberator:firearm.recoil",
      "weapons/sg-8-punisher:firearm.recoil",
    ]);
  });

  it("returns null when nothing conflicts", () => {
    expect(mergeConflicts(undefined, ["weapons"], [])).toBeNull();
    expect(
      mergeConflicts({ conflicts: [conflict("weapons", "a", "b")] }, ["weapons"], []),
    ).toBeNull();
  });
});

describe("reports", () => {
  const report: RunReport = {
    ok: true,
    changed: true,
    date: "2026-09-15",
    mode: "online",
    fullRefresh: false,
    dataVersion: "2026-09-15.1a2b3c4d",
    previousDataVersion: "2026-09-14.0d15ea5e",
    counts: [{ collection: "boosters", before: 17, after: 18 }],
    changes: [
      { collection: "boosters", id: "stun-pods", kind: "added" },
      { collection: "boosters", id: "dead-sprint", kind: "changed", paths: ["source.cost.amount"] },
    ],
    conflicts: 2,
    warnings: [],
    quarantined: [],
    wikiFixes: [],
    failure: null,
    http: { requests: 20, notModified: 19, bytes: 60_000, retries: 0, pauses: 0 },
    images: {
      requested: 18,
      reused: 17,
      fetched: 1,
      uploaded: 1,
      failed: 0,
      deleted: 0,
      images: 18,
      orphans: 1,
      bytes: 90_000,
    },
    durationMs: 83_000,
  };

  it("renders the commit message", () => {
    expect(renderCommitMessage(report)).toBe(
      "chore(data): update 2026-09-15 (+1 ~1 -0)\n\nboosters: +1 ~1 -0\n",
    );
  });

  it("renders the job summary", () => {
    const summary = renderSummary(report);
    expect(summary).toContain("## Scrape 2026-09-15 · ok");
    expect(summary).toContain("| boosters | 17 | 18 | +1 ~1 -0 |");
    expect(summary).toContain("Requests 20 · 304 19 (95 %) · 58.6 KB · retries 0 · pauses 0");
    expect(summary).toContain("Conflicts 2 · warnings 0 · previous `2026-09-14.0d15ea5e`");
    expect(summary).toContain(
      "Images fetched 1 · uploaded 1 · reused 17 · failed 0 · orphans 1 (deleted 0) · 18 images, 87.9 KB",
    );
    expect(summary).toContain("- `boosters/dead-sprint` changed: `source.cost.amount`");
    expect(renderSummary({ ...report, changed: false, changes: [] })).toContain("No changes");
    expect(summary).not.toContain("### Quarantined");
  });

  it("lists quarantined entities in the job summary", () => {
    const summary = renderSummary({
      ...report,
      quarantined: [
        {
          collection: "boosters",
          id: "stun-pods",
          action: "kept-published",
          reasons: [
            "source.page: warbonds/helldivers-mobilize page 3 does not list boosters/stun-pods",
          ],
        },
        { collection: "boosters", id: "new-one", action: "held-back", reasons: ["a", "b"] },
      ],
    });
    expect(summary).toContain("### Quarantined (2)");
    expect(summary).toContain(
      "- `boosters/stun-pods` published version kept: source.page: warbonds/helldivers-mobilize page 3 does not list boosters/stun-pods",
    );
    expect(summary).toContain("- `boosters/new-one` new, held back: a; b");
  });
});
