import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle } from "../wiki/page.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawCost, RawLink } from "./raw.ts";

// `/wiki/<Name>_Warbond`: `h3 "Page N"` → `table.wikitable` `Icon | Item | Type | Cost`.
// Phase 2 only needs the page tables (rule 3 page fallback); Phase 3f adds the infobox.

export const RawWarbondItem = z.object({
  name: z.string().min(1),
  link: RawLink.nullable(),
  wikiType: z.string().min(1),
  cost: RawCost,
});

export const RawWarbondPage = z.object({
  title: z.string().min(1),
  pages: z
    .array(z.object({ number: z.number().int().positive(), items: z.array(RawWarbondItem).min(1) }))
    .min(1),
});

export type RawWarbondItem = z.infer<typeof RawWarbondItem>;
export type RawWarbondPage = z.infer<typeof RawWarbondPage>;

const COLUMNS = ["Icon", "Item", "Type", "Cost"] as const;

export function parseWarbondPage(html: string, { url }: { url: string }): RawWarbondPage {
  const $ = loadHtml(html);
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
        const cost = cell("Cost");
        return {
          name: textOf(cell("Item")),
          link: firstArticleLink(cell("Item")),
          wikiType: textOf(cell("Type")),
          cost: { text: textOf(cost), currency: detectCurrency(cost) },
        };
      })
      .filter((item) => item.name !== "");
    return [{ number: Number(number), items }];
  });

  return parseRaw(RawWarbondPage, { title: readCanonicalTitle($, url), pages }, url, "h3 Page N");
}

/**
 * Rule 3 fallback (arch §5.5): the one page whose table links to `title` as `wikiType`, or
 * as any type when `wikiType` is null (weapon rows say "Assault Rifle", "Explosive Primary"…).
 */
export function findItem(
  warbond: RawWarbondPage,
  title: string,
  wikiType: string | null,
): { page: number; item: RawWarbondItem } | null {
  const found = warbond.pages.flatMap((page) =>
    page.items
      .filter(
        (item) => item.link?.title === title && (wikiType === null || item.wikiType === wikiType),
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
): number | null {
  return findItem(warbond, title, wikiType)?.page ?? null;
}
