import {
  type Collection,
  type Dataset,
  type Id,
  IdCollisionError,
  IdLock,
  type IdLockFile,
} from "@hd2/schemas";
import type { ScrapeResult } from "../collections/types.ts";
import { HttpError } from "../http/client.ts";
import { MissingFixtureError, type WikiSource } from "../source.ts";
import { loadHtml } from "../wiki/html.ts";
import { readCanonicalTitle } from "../wiki/page.ts";
import { normalizeTitle } from "../wiki/title.ts";

// Rule 8 (arch §5.5): published ids never change, even when the wiki renames a page. A rename
// shows up after a scrape as a published id that disappeared while a new title got a new id (or,
// when both titles slugify alike, as an id collision); it is one when the old title now lands on
// the new one (HTTP redirect + canonical link). The new title is then locked to the old id and
// the pipelines run again, since other collections refer to the ids of this one.

export interface Rename {
  collection: Collection;
  from: string; // title locked before, now a redirect
  to: string; // canonical title it lands on
  id: Id;
}

const MAX_PASSES = 3;

/** Index-only rows are locked as `Title#Anchor`: no page of their own to follow. */
const isPageKey = (key: string) => !key.includes("#");

/** Canonical title of the page `title` lands on, or null when the wiki has no such page. */
async function landsOn(source: WikiSource, title: string): Promise<string | null> {
  try {
    const page = await source.page(title);
    return normalizeTitle(readCanonicalTitle(loadHtml(page.html), page.url));
  } catch (error) {
    if (
      error instanceof MissingFixtureError ||
      (error instanceof HttpError && error.status === 404)
    ) {
      return null;
    }
    throw error;
  }
}

/** Published ids of the scraped collections that only a renamed page lost. */
export async function findRenames(
  source: WikiSource,
  before: IdLockFile,
  after: IdLockFile,
  published: Dataset,
  results: readonly ScrapeResult[],
): Promise<Rename[]> {
  const renames: Rename[] = [];
  for (const { collection, entities } of results) {
    const scraped = new Set(entities.map((entity) => entity.id));
    const removed = new Set(
      (published[collection] ?? []).map((entity) => entity.id).filter((id) => !scraped.has(id)),
    );
    const locked = before[collection] ?? {};
    const added = new Set(
      Object.keys(after[collection] ?? {}).filter((key) => isPageKey(key) && !(key in locked)),
    );
    if (removed.size === 0 || added.size === 0) {
      continue;
    }
    const found: Rename[] = [];
    for (const [from, id] of Object.entries(locked)) {
      if (!removed.has(id) || !isPageKey(from)) {
        continue;
      }
      const to = await landsOn(source, from);
      if (to !== null && added.has(to)) {
        found.push({ collection, from, to, id });
      }
    }
    // Two old pages merged into one new title: no id to keep.
    renames.push(...found.filter((rename) => found.filter((r) => r.to === rename.to).length === 1));
  }
  return renames;
}

/**
 * Runs `scrape` with the id lock of `lock`, again with each renamed title locked to its published
 * id until no rename is left (at most three passes).
 */
export async function scrapeKeepingIds<T extends { results: readonly ScrapeResult[] }>(
  source: WikiSource,
  lock: IdLockFile,
  published: Dataset,
  scrape: (idLock: IdLock) => Promise<T>,
): Promise<{ output: T; idLock: IdLock; renames: Rename[] }> {
  const renames: Rename[] = [];
  for (let pass = 1; ; pass += 1) {
    const idLock = IdLock.from(lock);
    for (const rename of renames) {
      idLock.alias(rename.collection, rename.to, rename.id);
    }
    const before = idLock.toJSON();
    let found: Rename[];
    try {
      const output = await scrape(idLock);
      found = await findRenames(source, before, idLock.toJSON(), published, output.results);
      if (found.length === 0) {
        return { output, idLock, renames };
      }
    } catch (error) {
      // Titles that slugify alike: the new one collides with the id of the old one.
      if (!(error instanceof IdCollisionError) || !isPageKey(error.lockedKey)) {
        throw error;
      }
      if ((await landsOn(source, error.lockedKey)) !== normalizeTitle(error.key)) {
        throw error;
      }
      found = [
        { collection: error.collection, from: error.lockedKey, to: error.key, id: error.id },
      ];
    }
    if (pass === MAX_PASSES) {
      const list = found.map((r) => `${r.collection}/${r.id} "${r.from}" → "${r.to}"`).join(", ");
      throw new Error(`ids still change after ${MAX_PASSES} scrapes: ${list}`);
    }
    renames.push(...found);
  }
}
