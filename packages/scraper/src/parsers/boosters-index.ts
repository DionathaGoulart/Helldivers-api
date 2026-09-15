import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawCost, RawImage, RawLink } from "./raw.ts";

// `/wiki/Boosters`: one `table.wikitable.sortable` `Icon | Booster | Description | Warbond | Price`.

export const BOOSTERS_INDEX = "Boosters";

export const RawBoosterRow = z.object({
  name: z.string().min(1),
  page: RawLink, // the booster's own page
  effect: z.string().min(1),
  icon: RawImage.nullable(),
  warbond: RawLink, // anchor `Page_3` when the wiki gives one
  price: RawCost,
});

export type RawBoosterRow = z.infer<typeof RawBoosterRow>;

const TABLE = "#mw-content-text table.wikitable";
const COLUMNS = ["Icon", "Booster", "Description", "Warbond", "Price"] as const;

export function parseBoostersIndex(html: string, { url }: { url: string }): RawBoosterRow[] {
  const $ = loadHtml(html);
  const tables = $(TABLE);
  if (tables.length !== 1) {
    throw new ParseError(url, TABLE, `expected 1 table, found ${tables.length}`);
  }
  const table = readWikitable($, tables.first());
  const column = columnIndexes(table, COLUMNS, url, TABLE);
  if (table.rows.length === 0) {
    throw new ParseError(url, `${TABLE} tr`, "no booster rows");
  }

  return table.rows.map((row, i) => {
    const selector = `${TABLE} tr:nth-of-type(${i + 2})`;
    const cell = (name: (typeof COLUMNS)[number]) => cellAt(row, column[name], url, selector);
    const price = cell("Price");
    return parseRaw(
      RawBoosterRow,
      {
        name: textOf(cell("Booster")),
        page: firstArticleLink(cell("Booster")),
        effect: textOf(cell("Description")),
        icon: firstImage(cell("Icon")),
        warbond: firstArticleLink(cell("Warbond")),
        price: { text: textOf(price), currency: detectCurrency(price) },
      },
      url,
      selector,
    );
  });
}
