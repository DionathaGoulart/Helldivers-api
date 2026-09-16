import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { readDruid } from "../wiki/druid.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories, readLead } from "../wiki/page.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawCost, RawImage, RawLink } from "./raw.ts";

// `/wiki/<Name>_Warbond` (arch §4.3): DRUID `date`, `cost`, `credit-claim`, `all-pages`,
// `all-items` and the cover; `h3 "Page N"` → `table.wikitable` `Icon | Item | Type | Cost`.
// Item pipelines read only the page tables (rule 3 page fallback); the warbonds pipeline reads
// everything. An unreleased warbond (Ironclad Democracy, 2026-09-16) has no medal totals yet.

export const RawWarbondItem = z.object({
  name: z.string().min(1),
  link: RawLink.nullable(),
  wikiType: z.string().min(1),
  cost: RawCost,
});

export const RawWarbondPage = z.object({
  title: z.string().min(1), // canonical page title
  name: z.string().min(1), // DRUID title, "Helldivers Mobilize!"
  lead: z.string().min(1).nullable(),
  categories: z.array(z.string()),
  image: RawImage.nullable(), // cover
  releaseDate: z.string().min(1), // "August 12th, 2026"
  cost: RawCost, // "1,000 Super Credits", "Free"
  creditsClaimable: RawCost, // "300 Super Credits", "None"
  medalsAllPages: RawCost.nullable(),
  medalsAllItems: RawCost.nullable(),
  pages: z
    .array(z.object({ number: z.number().int().positive(), items: z.array(RawWarbondItem).min(1) }))
    .min(1),
});

export type RawWarbondItem = z.infer<typeof RawWarbondItem>;
export type RawWarbondPage = z.infer<typeof RawWarbondPage>;

const COLUMNS = ["Icon", "Item", "Type", "Cost"] as const;

const rawCost = (cell: Cheerio<Element>) => ({
  text: textOf(cell),
  currency: detectCurrency(cell),
});

export function parseWarbondPage(html: string, { url }: { url: string }): RawWarbondPage {
  const $ = loadHtml(html);
  const druid = readDruid($, url);
  const row = (key: string) => {
    const found = druid.rows.get(key);
    return found ? rawCost(found.data) : null;
  };
  const pages = readSections($, 3).flatMap((section) => {
    const number = /^Page (\d+)$/.exec(section.title)?.[1];
    if (!number) {
      return [];
    }
    const selector = `h3#${section.id} table.wikitable`;
    const tables = findInSection(section, "table.wikitable");
    if (tables.length !== 1) {
      throw new ParseError(url, selector, `expected 1 table, found ${tables.length}`);
    }
    const table = readWikitable($, tables.first());
    const column = columnIndexes(table, COLUMNS, url, selector);
    // Only full item rows; summary lines such as "Total page cost" have fewer cells (arch §4.5).
    const items = table.rows
      .filter((row) => row.cells.length === COLUMNS.length)
      .map((row) => {
        const cell = (name: (typeof COLUMNS)[number]) => cellAt(row, column[name], url, selector);
        return {
          name: textOf(cell("Item")),
          link: firstArticleLink(cell("Item")),
          wikiType: textOf(cell("Type")),
          cost: rawCost(cell("Cost")),
        };
      })
      .filter((item) => item.name !== "");
    return [{ number: Number(number), items }];
  });

  return parseRaw(
    RawWarbondPage,
    {
      title: readCanonicalTitle($, url),
      name: druid.title,
      lead: readLead($),
      categories: readCategories($),
      image: druid.image,
      releaseDate: row("date")?.text,
      cost: row("cost"),
      creditsClaimable: row("credit-claim"),
      medalsAllPages: row("all-pages"),
      medalsAllItems: row("all-items"),
      pages,
    },
    url,
    ".druid-infobox, h3 Page N",
  );
}

const sameName = (a: string, b: string) =>
  a.replaceAll("’", "'").replace(/\s+/g, " ").trim() ===
  b.replaceAll("’", "'").replace(/\s+/g, " ").trim();

/**
 * Rule 3 fallback (arch §5.5): the one page whose table links to `title` as `wikiType`, or
 * as any type when `wikiType` is null (weapon rows say "Assault Rifle", "Explosive Primary"…).
 * `name` also matches the row name, for rows linking the same page (rule 10: pattern variants
 * `Castellans Green Hellpod` / `… Shuttle` all link `Castellans Green Pattern`), and stands in
 * for the link on rows without one (titles such as `Still Standing`).
 */
export function findItem(
  warbond: RawWarbondPage,
  title: string,
  wikiType: string | null,
  name: string | null = null,
): { page: number; item: RawWarbondItem } | null {
  const found = warbond.pages.flatMap((page) =>
    page.items
      .filter(
        (item) =>
          (item.link ? item.link.title === title : name !== null) &&
          (wikiType === null || item.wikiType === wikiType) &&
          (name === null || sameName(item.name, name)),
      )
      .map((item) => ({ page: page.number, item })),
  );
  const pages = new Set(found.map(({ page }) => page));
  return pages.size === 1 && found[0] ? found[0] : null;
}

export function findItemPage(
  warbond: RawWarbondPage,
  title: string,
  wikiType: string | null,
  name: string | null = null,
): number | null {
  return findItem(warbond, title, wikiType, name)?.page ?? null;
}
