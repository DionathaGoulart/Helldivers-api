import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { readItemBoxes } from "../wiki/itemgrid.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { ownElements, readTabberPanels, type TabberPanel } from "../wiki/tabber.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawCost, RawImage, RawLink, RawSourceCell } from "./raw.ts";

// `/wiki/Armor` (arch §4.3): tabber `Armor` › `Light` / `Medium` / `Heavy`, one
// `table.wikitable` each (`Icon | Name | Armor | Speed | Stamina | Passive | Cost | Source`);
// tabs `Helmet` and `Cape` hold one item grid each. `/wiki/Cosmetics` repeats the helmet and
// cape grids without the unreleased items, so this page is the index of all three collections.

export const ARMOR_INDEX = "Armor";

export const ARMOR_WEIGHT_TABS = ["Light", "Medium", "Heavy"] as const;

export const RawArmorRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  weight: z.enum(ARMOR_WEIGHT_TABS), // tab label
  armor: z.string().min(1), // "050": zero-padded with a grey `0`
  speed: z.string().min(1),
  stamina: z.string().min(1),
  passive: RawLink,
  cost: RawCost, // empty text when the cell is empty
  source: RawSourceCell,
  icon: RawImage.nullable(),
});

export const RawItemBox = z.object({
  name: z.string().min(1),
  page: RawLink,
  source: RawSourceCell.nullable(),
  cost: RawCost.nullable(), // null when the box names no cost
  image: RawImage.nullable(),
});

export const RawArmorIndex = z.object({
  armors: z.array(RawArmorRow).min(1),
  helmets: z.array(RawItemBox).min(1),
  capes: z.array(RawItemBox).min(1),
});

export type RawArmorRow = z.infer<typeof RawArmorRow>;
export type RawItemBox = z.infer<typeof RawItemBox>;
export type RawArmorIndex = z.infer<typeof RawArmorIndex>;

const COLUMNS = ["Icon", "Name", "Armor", "Speed", "Stamina", "Passive", "Cost", "Source"] as const;

export function parseArmorIndex(html: string, { url }: { url: string }): RawArmorIndex {
  const $ = loadHtml(html);
  const panels = readTabberPanels($, $("#mw-content-text"));
  const panel = (...path: string[]): TabberPanel => {
    const matches = panels.filter((candidate) => candidate.path.join("/") === path.join("/"));
    if (matches.length !== 1 || !matches[0]) {
      throw new ParseError(
        url,
        `tabber panel ${path.join(" › ")}`,
        `expected 1, found ${matches.length}`,
      );
    }
    return matches[0];
  };

  const armors = ARMOR_WEIGHT_TABS.flatMap((weight) => {
    const tab = panel("Armor", weight);
    const selector = `#${tab.id} table.wikitable`;
    const tables = ownElements($, tab, "table.wikitable");
    if (tables.length !== 1) {
      throw new ParseError(url, selector, `expected 1 table, found ${tables.length}`);
    }
    const table = readWikitable($, tables.first());
    const column = columnIndexes(table, COLUMNS, url, selector);
    if (table.rows.length === 0) {
      throw new ParseError(url, selector, "no armors");
    }
    return table.rows.map((row, i) => {
      const cell = (name: (typeof COLUMNS)[number]) => cellAt(row, column[name], url, selector);
      const cost = cell("Cost");
      const source = cell("Source");
      return parseRaw(
        RawArmorRow,
        {
          name: textOf(cell("Name")),
          page: firstArticleLink(cell("Name")),
          weight,
          armor: textOf(cell("Armor")),
          speed: textOf(cell("Speed")),
          stamina: textOf(cell("Stamina")),
          passive: firstArticleLink(cell("Passive")),
          cost: { text: textOf(cost), currency: detectCurrency(cost) },
          source: {
            label: textOf(source),
            link: firstArticleLink(source),
            pageMarker: source.find("small .explain[title]").first().attr("title") ?? null,
          },
          icon: firstImage(cell("Icon")),
        },
        url,
        `${selector} tr:eq(${i + 1})`,
      );
    });
  });

  const boxes = (label: "Helmet" | "Cape") => {
    const tab = panel(label);
    const selector = `#${tab.id} .hd2-itembox`;
    const items = readItemBoxes($, ownElements($, tab, ".hd2-itembox"));
    if (items.length === 0) {
      throw new ParseError(url, selector, "no items");
    }
    return items.map((item, i) => parseRaw(RawItemBox, item, url, `${selector}:eq(${i})`));
  };

  return parseRaw(
    RawArmorIndex,
    { armors, helmets: boxes("Helmet"), capes: boxes("Cape") },
    url,
    "#mw-content-text",
  );
}
