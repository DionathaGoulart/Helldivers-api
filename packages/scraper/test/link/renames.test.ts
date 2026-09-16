import { IdCollisionError, type IdLock } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import type { ScrapeResult } from "../../src/collections/types.ts";
import { findRenames, scrapeKeepingIds } from "../../src/link/renames.ts";
import { MissingFixtureError, type WikiPage, type WikiSource } from "../../src/source.ts";
import { normalizeTitle, wikiUrl } from "../../src/wiki/title.ts";
import { article } from "../fixtures.ts";

/** Pages by requested title; each names the title it lands on in its canonical link. */
class RedirectSource implements WikiSource {
  readonly offline = true;
  readonly requested: string[] = [];

  constructor(readonly landsOn: Readonly<Record<string, string>>) {}

  robotsTxt(): Promise<string> {
    return Promise.resolve("");
  }

  async page(title: string): Promise<WikiPage> {
    const normalized = normalizeTitle(title);
    this.requested.push(normalized);
    const target = this.landsOn[normalized];
    if (!target) {
      throw new MissingFixtureError(normalized);
    }
    const head = `<link rel="canonical" href="${wikiUrl(target)}">`;
    return {
      title: normalized,
      url: wikiUrl(normalized),
      html: article("", head),
      fromCache: true,
      lastModified: null,
    };
  }
}

const boosters = (...ids: string[]) => ids.map((id) => ({ id })) as never[];
const result = (...ids: string[]): ScrapeResult => ({
  collection: "boosters",
  entities: boosters(...ids),
  indexCount: ids.length,
  warnings: [],
  conflicts: [],
});

describe("findRenames", () => {
  const before = { boosters: { "Old Title": "old-title", "Kept Title": "kept-title" } };
  const after = { boosters: { ...before.boosters, "New Title": "new-title" } };
  const published = { boosters: boosters("old-title", "kept-title") };

  it("finds a published id whose page now lands on a newly locked title", async () => {
    const source = new RedirectSource({ "Old Title": "New Title" });
    expect(
      await findRenames(source, before, after, published, [result("new-title", "kept-title")]),
    ).toEqual([{ collection: "boosters", from: "Old Title", to: "New Title", id: "old-title" }]);
    expect(source.requested).toEqual(["Old Title"]);
  });

  it("ignores removed pages, pages that still exist and runs without a new title", async () => {
    const results = [result("new-title", "kept-title")];
    expect(await findRenames(new RedirectSource({}), before, after, published, results)).toEqual(
      [],
    );
    const stays = new RedirectSource({ "Old Title": "Old Title" });
    expect(await findRenames(stays, before, after, published, results)).toEqual([]);
    const unchanged = new RedirectSource({ "Old Title": "New Title" });
    expect(await findRenames(unchanged, before, before, published, [result("kept-title")])).toEqual(
      [],
    );
    expect(unchanged.requested).toEqual([]);
  });

  it("keeps no id when two old pages now land on the same title", async () => {
    const source = new RedirectSource({ "Old Title": "New Title", "Kept Title": "New Title" });
    expect(await findRenames(source, before, after, published, [result("new-title")])).toEqual([]);
  });
});

describe("scrapeKeepingIds", () => {
  const published = { boosters: boosters("old-title") };

  it("scrapes again with the new title locked to the published id", async () => {
    const source = new RedirectSource({ "Old Title": "New Title" });
    const ids: string[] = [];
    const scrape = async (idLock: IdLock) => {
      const id = idLock.resolve("boosters", "New Title", "New Title");
      ids.push(id);
      return { results: [result(id)] };
    };
    const { idLock, renames } = await scrapeKeepingIds(
      source,
      { boosters: { "Old Title": "old-title" } },
      published,
      scrape,
    );
    expect(ids).toEqual(["new-title", "old-title"]);
    expect(renames).toEqual([
      { collection: "boosters", from: "Old Title", to: "New Title", id: "old-title" },
    ]);
    expect(idLock.toJSON()).toEqual({
      boosters: { "New Title": "old-title", "Old Title": "old-title" },
    });
  });

  it("turns an id collision into a rename when the old title lands on the new one", async () => {
    const lock = { boosters: { "Old Title!": "old-title" } };
    const scrape = async (idLock: IdLock) => ({
      results: [result(idLock.resolve("boosters", "Old Title", "Old Title"))],
    });
    const renamed = new RedirectSource({ "Old Title!": "Old Title" });
    const { renames } = await scrapeKeepingIds(renamed, lock, published, scrape);
    expect(renames).toEqual([
      { collection: "boosters", from: "Old Title!", to: "Old Title", id: "old-title" },
    ]);
    await expect(
      scrapeKeepingIds(new RedirectSource({ "Old Title!": "Old Title!" }), lock, published, scrape),
    ).rejects.toThrow(IdCollisionError);
  });
});
