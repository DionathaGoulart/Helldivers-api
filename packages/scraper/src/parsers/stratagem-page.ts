import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { type DruidRow, readDruid } from "../wiki/druid.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories, readLead } from "../wiki/page.ts";
import { readCodeArrows } from "../wiki/stratagem-code.ts";
import { RawCost, RawImage, RawLink } from "./raw.ts";
import { articleLinks, RawInfoboxRow, RawStatTable, rawText, readTables } from "./weapon-page.ts";

// `/wiki/<Stratagem>` (arch §4.3): DRUID `.druid-container-stratagem`, or tabs `Stratagem` /
// `Weapon` on support weapons (each row is filled in one tab); the `General` table (Call-in
// Time, Uses, Cooldown with upgrade variants, and a `Sentry` section on sentries); the same
// detailed statistics tables as weapon pages; and the `Department | Ship Module | Effect`
// table, whose section is "Applicable Ship Modules", "Affected by" or "Relevant Ship Modules".

export const RawGeneralRow = z.object({
  section: z.string().min(1), // colspan title row: "General", "Sentry"
  label: z.string().min(1), // "Cooldown"
  variant: z.string().min(1).nullable(), // "Standard", "With Morale Augmentation"
  text: z.string(),
});

export const RawShipModule = z.object({
  department: z.string().min(1), // "Patriotic Administration Center"
  module: z.string().min(1),
  effect: z.string().min(1),
});

export const RawStratagemPage = z.object({
  title: z.string().min(1), // canonical page title
  name: z.string().min(1), // DRUID title
  lead: z.string().min(1).nullable(),
  categories: z.array(z.string()),
  image: RawImage.nullable(),
  infobox: z.array(RawInfoboxRow.extend({ tab: z.string().nullable() })), // tab that fills the row
  code: z.array(z.string().min(1)), // `stratagem_code` arrows, "Up"
  source: z
    .object({
      label: z.string().min(1),
      link: RawLink.nullable(),
      pageMarker: z.string().nullable(),
    })
    .nullable(),
  cost: RawCost.nullable(), // `unlock_cost`
  general: z.array(RawGeneralRow),
  tables: z.array(RawStatTable),
  shipModules: z.array(RawShipModule),
});

export type RawGeneralRow = z.infer<typeof RawGeneralRow>;
export type RawShipModule = z.infer<typeof RawShipModule>;
export type RawStratagemPage = z.infer<typeof RawStratagemPage>;

const TABLES = "#mw-content-text table.wikitable";

function ownRows($: CheerioAPI, table: Element): Cheerio<Element>[] {
  return $(table)
    .find("tr")
    .toArray()
    .filter((tr) => $(tr).closest("table").get(0) === table)
    .map((tr) => $(tr));
}

const cellsOf = ($: CheerioAPI, tr: Cheerio<Element>) =>
  tr
    .children("th, td")
    .toArray()
    .map((cell) => $(cell));

// `parseInt` also reads malformed spans such as `rowspan="2""` (EAT-700 Expendable Napalm).
const span = (cell: Cheerio<Element>, attribute: "rowspan" | "colspan") =>
  Number.parseInt(cell.attr(attribute) ?? "1", 10) || 1;

/** The one filled toggle of a tabbed row, or the row itself; null when every tab is empty. */
function rowData(
  row: DruidRow,
  url: string,
): { data: Cheerio<Element>; tab: string | null } | null {
  if (row.byTab.size === 0) {
    return { data: row.data, tab: null };
  }
  const filled = [...row.byTab].filter(
    ([, toggle]) => textOf(toggle) !== "" || toggle.find("img").length > 0,
  );
  if (filled.length > 1) {
    const tabs = filled.map(([tab]) => tab).join(", ");
    throw new ParseError(url, `.druid-row-${row.key}`, `filled in several tabs (${tabs})`);
  }
  const [tab, data] = filled[0] ?? [];
  return tab !== undefined && data ? { data, tab } : null;
}

// `General` table: a colspan row per section; a `th` label, with `rowspan` when variants follow
// (`td` variant + `td` value), else one `colspan=2` value. Exosuit pages put labels in `td`.
function readGeneral($: CheerioAPI, url: string): RawGeneralRow[] {
  const tables = $(TABLES)
    .toArray()
    .filter((table) => textOf(ownRows($, table)[0] ?? $([])) === "General");
  if (tables.length > 1) {
    throw new ParseError(url, `${TABLES} General`, `expected at most 1, found ${tables.length}`);
  }
  const [table] = tables;
  if (!table) {
    return [];
  }

  const rows: RawGeneralRow[] = [];
  let section = "";
  let label: string | null = null;
  let pending = 0; // rows still covered by the label's rowspan
  ownRows($, table).forEach((tr, r) => {
    const selector = `${TABLES} General tr:eq(${r})`;
    const cells = cellsOf($, tr);
    const [first] = cells;
    if (!first) {
      return;
    }
    if (cells.length === 1 && first.is("th") && span(first, "colspan") > 1) {
      section = textOf(first);
      pending = 0;
      return;
    }
    let values = cells;
    if (pending > 0) {
      pending -= 1;
    } else {
      label = textOf(first);
      pending = span(first, "rowspan") - 1;
      values = cells.slice(1);
    }
    const [a, b] = values;
    if (!section || !label || !a || values.length > 2) {
      throw new ParseError(url, selector, `unexpected row of ${cells.length} cells`);
    }
    rows.push({
      section,
      label,
      variant: b ? textOf(a) : null,
      text: textOf(b ?? a),
    });
  });
  return rows;
}

const SHIP_MODULE_HEADERS = ["Department", "Ship Module", "Effect"];

function readShipModules($: CheerioAPI, url: string): RawShipModule[] {
  const tables = $(TABLES)
    .toArray()
    .filter((table) => {
      const header = cellsOf($, ownRows($, table)[0] ?? $([])).map((cell) => textOf(cell));
      return JSON.stringify(header) === JSON.stringify(SHIP_MODULE_HEADERS);
    });
  if (tables.length > 1) {
    throw new ParseError(
      url,
      `${TABLES} Ship Module`,
      `expected at most 1, found ${tables.length}`,
    );
  }
  const [table] = tables;
  if (!table) {
    return [];
  }

  const modules: RawShipModule[] = [];
  let department: string | null = null;
  let pending = 0;
  ownRows($, table)
    .slice(1)
    .forEach((tr, r) => {
      const selector = `${TABLES} Ship Module tr:eq(${r + 1})`;
      let cells = cellsOf($, tr);
      if (pending > 0 && cells.length === 2) {
        pending -= 1;
      } else if (cells.length === 3 && cells[0]) {
        department = textOf(cells[0]);
        pending = span(cells[0], "rowspan") - 1;
        cells = cells.slice(1);
      } else {
        throw new ParseError(url, selector, `unexpected row of ${cells.length} cells`);
      }
      const [module, effect] = cells;
      modules.push({
        department: department ?? "",
        module: module ? textOf(module) : "",
        effect: effect ? textOf(effect) : "",
      });
    });
  return modules;
}

export function parseStratagemPage(html: string, { url }: { url: string }): RawStratagemPage {
  const $ = loadHtml(html);
  const druid = readDruid($, url, "stratagem");

  const infobox: RawStratagemPage["infobox"] = [];
  let code: string[] = [];
  let source: RawStratagemPage["source"] = null;
  let cost: RawStratagemPage["cost"] = null;
  for (const row of druid.rows.values()) {
    const filled = rowData(row, url);
    if (!filled) {
      continue;
    }
    const { data, tab } = filled;
    if (row.key === "stratagem_code") {
      code = readCodeArrows($, data, url, `.druid-row-${row.key}`);
    } else if (row.key === "source") {
      source = {
        label: textOf(data),
        link: firstArticleLink(data),
        pageMarker: data.find("small .explain[title]").first().attr("title") ?? null,
      };
    } else if (row.key === "unlock_cost") {
      cost = { text: textOf(data), currency: detectCurrency(data) };
    }
    infobox.push({
      key: row.key,
      label: row.label,
      links: articleLinks($, data),
      ...rawText(data),
      tab,
    });
  }

  return parseRaw(
    RawStratagemPage,
    {
      title: readCanonicalTitle($, url),
      name: druid.title,
      lead: readLead($),
      categories: readCategories($),
      // Support weapon pages keep the icon in the `Stratagem` tab, the render in `Weapon`.
      image: druid.tabImages.get("Stratagem") ?? druid.image,
      infobox,
      code,
      source,
      cost,
      general: readGeneral($, url),
      tables: readTables($, url),
      shipModules: readShipModules($, url),
    },
    url,
    "#mw-content-text",
  );
}
