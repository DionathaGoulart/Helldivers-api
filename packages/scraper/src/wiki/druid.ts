import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../errors.ts";
import { textOf } from "./html.ts";
import { firstImage, type ImageRef } from "./links.ts";

// DRUID infoboxes (arch §4.2): `div.druid-infobox` › `.druid-row.druid-row-<key>` ›
// `.druid-label` + `.druid-data`. Tabbed infoboxes (`Body Armor` / `Helmet`) keep one
// `.druid-toggleable-data[data-druid-tab-key]` per tab inside each row, so the plain text of
// a row glues the tabs together (`"45 30"`); read a tab through `druidData`.

const INFOBOX = "#mw-content-text .druid-infobox";
const TOGGLE = ".druid-toggleable-data";

export interface DruidRow {
  key: string; // "fire_rate"
  label: string; // "Fire Rate"
  data: Cheerio<Element>; // `.druid-data`
  byTab: ReadonlyMap<string, Cheerio<Element>>; // empty when the row does not vary by tab
}

export interface Druid {
  container: string | null; // "weapon" from `druid-container-weapon`
  title: string; // `.druid-title`, the in-game name
  image: ImageRef | null; // first `.druid-main-image` picture
  tabs: string[]; // `data-druid-tab-key` values, in order
  rows: ReadonlyMap<string, DruidRow>;
}

export function readDruid($: CheerioAPI, page: string): Druid {
  const boxes = $(INFOBOX);
  if (boxes.length !== 1) {
    throw new ParseError(page, INFOBOX, `expected 1 infobox, found ${boxes.length}`);
  }
  const box = boxes.first();
  const container = /\bdruid-container-(\S+)/.exec(box.attr("class") ?? "")?.[1] ?? null;
  const title = textOf(box.find(".druid-title").first());
  if (!title) {
    throw new ParseError(page, `${INFOBOX} .druid-title`, "empty title");
  }

  const tabs = [
    ...new Set(
      box
        .find(".druid-tab[data-druid-tab-key]")
        .toArray()
        .map((tab) => $(tab).attr("data-druid-tab-key") ?? ""),
    ),
  ];

  const rows = new Map<string, DruidRow>();
  for (const element of box.find(".druid-row").toArray()) {
    const row = $(element);
    const key = /\bdruid-row-(\S+)/.exec(row.attr("class") ?? "")?.[1];
    const selector = `${INFOBOX} .druid-row-${key}`;
    if (!key) {
      throw new ParseError(page, `${INFOBOX} .druid-row`, "row without a key class");
    }
    if (rows.has(key)) {
      throw new ParseError(page, selector, "duplicate row");
    }
    const byTab = new Map<string, Cheerio<Element>>();
    for (const toggle of row.find(TOGGLE).toArray()) {
      byTab.set($(toggle).attr("data-druid-tab-key") ?? "", $(toggle));
    }
    rows.set(key, {
      key,
      label: textOf(row.find(".druid-label").first()),
      data: row.find(".druid-data").first(),
      byTab,
    });
  }

  return { container, title, image: firstImage(box.find(".druid-main-image").first()), tabs, rows };
}

/** A row's data for one tab; rows that do not vary by tab apply to every tab. */
export function druidData(row: DruidRow, tab: string | null = null): Cheerio<Element> | null {
  if (row.byTab.size === 0) {
    return row.data;
  }
  return tab === null ? null : (row.byTab.get(tab) ?? null);
}
