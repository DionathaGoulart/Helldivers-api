import { describe, expect, it } from "vitest";
import { Booster } from "../src/entities/booster.ts";
import { ChangelogEntry, DatasetManifest, List, Meta, Problem } from "../src/envelope.ts";

const meta = {
  apiVersion: "v1",
  dataVersion: "2026-09-15.1a2b3c4d",
  generatedAt: "2026-09-15T05:41:07Z",
  count: 0,
  source: { name: "The Helldivers Wiki", url: "https://helldivers.wiki.gg" },
};

describe("Meta", () => {
  it("accepts the arch §8.3 example", () => {
    expect(Meta.safeParse(meta).success).toBe(true);
  });

  it("allows count to be absent", () => {
    const { count: _count, ...withoutCount } = meta;
    expect(Meta.safeParse(withoutCount).success).toBe(true);
  });

  it.each(["2026-09-15", "2026-09-15.1A2B3C4D", "2026-09-15.1a2b3c"])(
    "rejects dataVersion %s",
    (dataVersion) => {
      expect(Meta.safeParse({ ...meta, dataVersion }).success).toBe(false);
    },
  );
});

describe("List", () => {
  it("wraps entity arrays", () => {
    expect(List(Booster).safeParse({ meta, data: [] }).success).toBe(true);
    expect(List(Booster).safeParse({ meta, data: [{ id: "x" }] }).success).toBe(false);
  });
});

describe("Problem", () => {
  it("accepts the arch §8.3 example", () => {
    const problem = {
      type: "https://helldivers-api.pages.dev/docs/errors#invalid-filter-value",
      title: "Invalid filter value",
      status: 400,
      detail: "Unknown value 'primray' for 'category'. Allowed: primary, secondary, throwable.",
      instance: "/v1/query/weapons?category=primray",
    };
    expect(Problem.safeParse(problem).success).toBe(true);
  });
});

describe("ChangelogEntry", () => {
  const entry = {
    dataVersion: "2026-09-15.1a2b3c4d",
    date: "2026-09-15",
    summary: { added: 1, changed: 1, removed: 0 },
    changes: [
      { collection: "stratagems", id: "40-k-meltagun", kind: "added" },
      { collection: "armors", id: "tg-8-sharpshooter", kind: "changed", paths: ["source.page"] },
    ],
  };

  it("accepts the arch §6.6 example", () => {
    expect(ChangelogEntry.safeParse(entry).success).toBe(true);
  });

  it("requires paths on changed entities", () => {
    const changes = [entry.changes[0], { ...entry.changes[1], paths: [] }];
    expect(ChangelogEntry.safeParse({ ...entry, changes }).success).toBe(false);
  });

  it("rejects a summary that does not match the changes", () => {
    const result = ChangelogEntry.safeParse({
      ...entry,
      summary: { added: 2, changed: 1, removed: 0 },
    });
    expect(result.error?.issues[0]?.message).toBe("summary counts must match changes");
  });
});

describe("DatasetManifest", () => {
  const manifest = {
    apiVersion: "v1",
    dataVersion: "2026-09-15.1a2b3c4d",
    generatedAt: "2026-09-15T05:41:07Z",
    source: meta.source,
    collections: { boosters: { count: 18 } },
  };

  it("accepts a partial set of collections", () => {
    expect(DatasetManifest.safeParse(manifest).success).toBe(true);
  });

  it("rejects unknown collections", () => {
    const collections = { ...manifest.collections, enemies: { count: 1 } };
    expect(DatasetManifest.safeParse({ ...manifest, collections }).success).toBe(false);
  });
});
