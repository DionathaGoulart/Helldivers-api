import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readSections } from "../wiki/sections.ts";
import { ownElements, readTabberPanels } from "../wiki/tabber.ts";
import { linkFromHref } from "../wiki/title.ts";
import { RawCost, RawLink } from "./raw.ts";

// `/wiki/Superstore` (arch §4.3): `h2#Stock` tabber `Page 1` … `Page N`. Each tab holds one
// `.warbond-cell[title="Diagram of the Noblest Payload (Cape) (100 SC)"]` per item (item page link,
// SC price) and a collapsed "Release Order" `table.wikitable.tableleftjustified`: a caption row
// (`Exo Experts`, linked to the warbond the set was released with), `Item | Cost` rows (the item
// link only on the first row of a page: `O-44 Bonded Pilot Helmet`) and `TOTAL`.

export const SUPERSTORE = "Superstore";

export const RawStoreItem = z.object({
  name: z.string().min(1), // "Diagram of the Noblest Payload"
  type: z.string().min(1).nullable(), // "Cape", "PlayerCard"; null for weapons and stratagems
  link: RawLink,
  cost: RawCost,
});

export const RawStoreSetRow = z.object({
  text: z.string().min(1), // "O-44 Bonded Pilot Helmet": name and type glued
  link: RawLink.nullable(),
  cost: RawCost,
});

export const RawStoreSet = z.object({
  label: z.string().min(1), // "Exo Experts", "Steeled Veterans, page 1", "War Horses"
  link: RawLink.nullable(),
  items: z.array(RawStoreSetRow).min(1),
  total: RawCost.nullable(),
});

export const RawSuperstore = z.object({
  pages: z
    .array(
      z.object({
        number: z.number().int().positive(),
        items: z.array(RawStoreItem).min(1),
        set: RawStoreSet, // release order table of the tab
      }),
    )
    .min(1),
});

export type RawStoreItem = z.infer<typeof RawStoreItem>;
export type RawStoreSet = z.infer<typeof RawStoreSet>;
export type RawSuperstore = z.infer<typeof RawSuperstore>;

const CELL = ".warbond-cell";
const CELL_TITLE = /^(.+?)(?: \(([^()]+)\))? \(\d[\d,]* SC\)$/;

function readSet($: CheerioAPI, table: Element, url: string, selector: string) {
  const rows = $(table)
    .find("tr")
    .toArray()
    .filter((tr) => $(tr).closest("table").get(0) === table)
    .map((tr) => $(tr).children("th, td").toArray());
  const [caption, header, ...body] = rows;
  const headers = (header ?? []).map((cell) => textOf($(cell)));
  if (caption?.length !== 1 || !caption[0] || headers.join(" | ") !== "Item | Cost") {
    throw new ParseError(url, selector, `unexpected header ${JSON.stringify(headers)}`);
  }
  let total: RawCost | null = null;
  const items = body.flatMap((cells) => {
    const [item, price] = cells.map((cell) => $(cell));
    if (cells.length !== 2 || !item || !price) {
      throw new ParseError(url, selector, `row has ${cells.length} cells, needs 2`);
    }
    const cost = { text: textOf(price), currency: detectCurrency(price) };
    if (textOf(item) === "TOTAL") {
      total = cost;
      return [];
    }
    return [{ text: textOf(item), link: firstArticleLink(item), cost }];
  });
  const label = $(caption[0]);
  return { label: textOf(label), link: firstArticleLink(label), items, total };
}

function readPages($: CheerioAPI, url: string) {
  const stock = readSections($, 2).filter((section) => section.id === "Stock");
  if (stock.length !== 1 || !stock[0]) {
    throw new ParseError(url, "h2#Stock", `expected 1 section, found ${stock.length}`);
  }
  return readTabberPanels($, stock[0].content).map((panel) => {
    const selector = `h2#Stock #${panel.id}`;
    const number = /^Page (\d+)$/.exec(panel.label)?.[1];
    if (!number) {
      throw new ParseError(url, selector, `unexpected tab "${panel.label}"`);
    }
    const items = ownElements($, panel, CELL)
      .toArray()
      .map((element) => {
        const cell = $(element);
        const title = cell.attr("title") ?? "";
        const match = CELL_TITLE.exec(title);
        if (!match?.[1]) {
          throw new ParseError(
            url,
            `${selector} ${CELL}`,
            `unexpected title ${JSON.stringify(title)}`,
          );
        }
        const link = linkFromHref(cell.children("a[href]").first().attr("href") ?? "");
        const price = cell.find(".warbond-cell-medals-container");
        return {
          name: match[1],
          type: match[2] ?? null,
          link: link ? { label: match[1], ...link } : null,
          cost: { text: textOf(price), currency: detectCurrency(price) },
        };
      });
    const tables = ownElements($, panel, "table.wikitable").toArray();
    if (tables.length !== 1 || !tables[0]) {
      throw new ParseError(
        url,
        `${selector} table.wikitable`,
        `expected 1, found ${tables.length}`,
      );
    }
    const set = readSet($, tables[0], url, `${selector} table.wikitable`);
    return { number: Number(number), items, set };
  });
}

export function parseSuperstore(html: string, { url }: { url: string }): RawSuperstore {
  const $ = loadHtml(html);
  return parseRaw(RawSuperstore, { pages: readPages($, url) }, url, "h2#Stock");
}
