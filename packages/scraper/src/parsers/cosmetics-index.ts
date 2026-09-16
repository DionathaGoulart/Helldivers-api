import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { readItemBoxes } from "../wiki/itemgrid.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories } from "../wiki/page.ts";
import { findInSection, readSections, type Section } from "../wiki/sections.ts";
import { ownElements, readTabberPanels } from "../wiki/tabber.ts";
import {
  cellAt,
  columnIndexes,
  expandColspans,
  readWikitable,
  type Wikitable,
  type WikitableRow,
} from "../wiki/wikitable.ts";
import { RawItemBox } from "./armor-index.ts";
import { RawCost, RawImage, RawLink, RawSourceCell } from "./raw.ts";

// `/wiki/Cosmetics` (arch §4.3): `h2 "Capes and Player Cards"` › `details` "Player Cards" item
// grid; `h2 "Emotes and Poses"` table; `h2 "Patterns"` tabber `Vehicle` / `Weapon`, one table
// each; `h2 "Titles"` rank table (`Level Earned`) and acquirable table (`Source`, `Cost`).
// Emotes, weapon patterns and titles are index-only (rule 11). The helmet and cape grids of
// this page lack unreleased items, so `/wiki/Armor` stays their index (arch §6.11).

export const COSMETICS_INDEX = "Cosmetics";

export const RawEmoteRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  cost: RawCost, // `/` = no cost
  source: RawSourceCell, // Acquisition column
  emote: z.string().min(1), // ✅ / ❌
  victoryPose: z.string().min(1),
  icon: RawImage.nullable(),
});

export const VEHICLE_PATTERN_COLUMNS = {
  shuttle: "Shuttle Cost",
  hellpod: "Hellpod Cost",
  exosuit: "Exosuit Cost",
  vehicle: "Vehicle Cost",
} as const;

export const RawVehiclePatternRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  costs: z.object({ shuttle: RawCost, hellpod: RawCost, exosuit: RawCost, vehicle: RawCost }),
  source: RawSourceCell,
  icon: RawImage.nullable(), // the Hellpod variant
});

export const RawWeaponPatternRow = z.object({
  name: z.string().min(1),
  cost: RawCost,
  levelNeeded: z.string().min(1),
  image: RawImage.nullable(), // AR-23P render wearing the pattern
});

export const RawRankTitleRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  level: z.string().min(1),
  icon: RawImage.nullable(),
});

export const RawAcquirableTitleRow = z.object({
  name: z.string().min(1), // "[Redacted]" links `/wiki/Redacted`
  page: RawLink,
  source: RawSourceCell,
  cost: RawCost,
  icon: RawImage.nullable(),
});

export const RawCosmeticsIndex = z.object({
  title: z.string().min(1),
  categories: z.array(z.string()),
  playerCards: z.array(RawItemBox).min(1),
  emotes: z.array(RawEmoteRow).min(1),
  vehiclePatterns: z.array(RawVehiclePatternRow).min(1),
  weaponPatterns: z.array(RawWeaponPatternRow).min(1),
  rankTitles: z.array(RawRankTitleRow).min(1),
  acquirableTitles: z.array(RawAcquirableTitleRow).min(1),
});

export type RawEmoteRow = z.infer<typeof RawEmoteRow>;
export type RawVehiclePatternRow = z.infer<typeof RawVehiclePatternRow>;
export type RawWeaponPatternRow = z.infer<typeof RawWeaponPatternRow>;
export type RawRankTitleRow = z.infer<typeof RawRankTitleRow>;
export type RawAcquirableTitleRow = z.infer<typeof RawAcquirableTitleRow>;
export type RawCosmeticsIndex = z.infer<typeof RawCosmeticsIndex>;

const EMOTE_COLUMNS = ["Icon", "Name", "Cost", "Acquisition", "Emote", "Victory Pose"] as const;
const VEHICLE_COLUMNS = [
  "Icon",
  "Name",
  ...Object.values(VEHICLE_PATTERN_COLUMNS),
  "Acquisition",
] as const;
const WEAPON_COLUMNS = ["Pattern", "Name", "Cost", "Level Needed"] as const;
const RANK_COLUMNS = ["Icon", "Title", "Level Earned"] as const;
const ACQUIRABLE_COLUMNS = ["Icon", "Title", "Source", "Cost"] as const;

type Cell = ReturnType<typeof cellAt>;

const costOf = (cell: Cell) => ({ text: textOf(cell), currency: detectCurrency(cell) });

const sourceOf = (cell: Cell) => ({
  label: textOf(cell),
  link: firstArticleLink(cell),
  pageMarker: cell.find("small .explain[title]").first().attr("title") ?? null,
});

export function parseCosmeticsIndex(html: string, { url }: { url: string }): RawCosmeticsIndex {
  const $ = loadHtml(html);
  const sections = readSections($, 2);
  const section = (title: string): Section => {
    const matches = sections.filter((candidate) => candidate.title === title);
    if (matches.length !== 1 || !matches[0]) {
      throw new ParseError(url, `h2 "${title}"`, `expected 1, found ${matches.length}`);
    }
    return matches[0];
  };

  // Rows of `table`, after checking its columns; colspans are expanded (Standard pattern).
  const rowsOf = <const Name extends string>(
    table: Wikitable,
    columns: readonly Name[],
    selector: string,
  ) => {
    const column = columnIndexes(table, columns, url, selector);
    if (table.rows.length === 0) {
      throw new ParseError(url, selector, "no rows");
    }
    return table.rows.map((row, i) => {
      const expanded: WikitableRow = expandColspans(row);
      const rowSelector = `${selector} tr:eq(${i + 1})`;
      return {
        selector: rowSelector,
        cell: (name: Name) => cellAt(expanded, column[name], url, rowSelector),
      };
    });
  };

  return parseRaw(
    RawCosmeticsIndex,
    {
      title: readCanonicalTitle($, url),
      categories: readCategories($),
      playerCards: readPlayerCards($, section("Capes and Player Cards"), url),
      emotes: rowsOf(
        onlyTable($, section("Emotes and Poses"), url),
        EMOTE_COLUMNS,
        'h2 "Emotes and Poses" table',
      ).map(({ cell, selector }) =>
        parseRaw(
          RawEmoteRow,
          {
            name: textOf(cell("Name")),
            page: firstArticleLink(cell("Name")),
            cost: costOf(cell("Cost")),
            source: sourceOf(cell("Acquisition")),
            emote: textOf(cell("Emote")),
            victoryPose: textOf(cell("Victory Pose")),
            icon: firstImage(cell("Icon")),
          },
          url,
          selector,
        ),
      ),
      vehiclePatterns: rowsOf(
        patternTable($, section("Patterns"), "Vehicle", url),
        VEHICLE_COLUMNS,
        "#Vehicle table",
      ).map(({ cell, selector }) =>
        parseRaw(
          RawVehiclePatternRow,
          {
            name: textOf(cell("Name")),
            page: firstArticleLink(cell("Name")),
            costs: Object.fromEntries(
              Object.entries(VEHICLE_PATTERN_COLUMNS).map(([target, column]) => [
                target,
                costOf(cell(column)),
              ]),
            ),
            source: sourceOf(cell("Acquisition")),
            icon: firstImage(cell("Icon")),
          },
          url,
          selector,
        ),
      ),
      weaponPatterns: rowsOf(
        patternTable($, section("Patterns"), "Weapon", url),
        WEAPON_COLUMNS,
        "#Weapon table",
      ).map(({ cell, selector }) =>
        parseRaw(
          RawWeaponPatternRow,
          {
            name: textOf(cell("Name")),
            cost: costOf(cell("Cost")),
            levelNeeded: textOf(cell("Level Needed")),
            image: firstImage(cell("Pattern")),
          },
          url,
          selector,
        ),
      ),
      rankTitles: rowsOf(
        titleTable($, section("Titles"), "Level Earned", url),
        RANK_COLUMNS,
        'h2 "Titles" rank table',
      ).map(({ cell, selector }) =>
        parseRaw(
          RawRankTitleRow,
          {
            name: textOf(cell("Title")),
            page: firstArticleLink(cell("Title")),
            level: textOf(cell("Level Earned")),
            icon: firstImage(cell("Icon")),
          },
          url,
          selector,
        ),
      ),
      acquirableTitles: rowsOf(
        titleTable($, section("Titles"), "Source", url),
        ACQUIRABLE_COLUMNS,
        'h2 "Titles" acquirable table',
      ).map(({ cell, selector }) =>
        parseRaw(
          RawAcquirableTitleRow,
          {
            name: textOf(cell("Title")),
            page: firstArticleLink(cell("Title")),
            source: sourceOf(cell("Source")),
            cost: costOf(cell("Cost")),
            icon: firstImage(cell("Icon")),
          },
          url,
          selector,
        ),
      ),
    },
    url,
    "#mw-content-text",
  );
}

/** Boxes of the `details` whose `summary` is "Player Cards". */
function readPlayerCards($: CheerioAPI, section: Section, url: string) {
  const selector = 'h2 "Capes and Player Cards" details "Player Cards" .hd2-itembox';
  const details = findInSection(section, "details").filter(
    (_, element) => textOf($(element).children("summary").first()) === "Player Cards",
  );
  if (details.length !== 1) {
    throw new ParseError(url, selector, `expected 1 details, found ${details.length}`);
  }
  const boxes = readItemBoxes($, details.find(".hd2-itembox"));
  if (boxes.length === 0) {
    throw new ParseError(url, selector, "no items");
  }
  return boxes.map((box, i) => parseRaw(RawItemBox, box, url, `${selector}:eq(${i})`));
}

function onlyTable($: CheerioAPI, section: Section, url: string): Wikitable {
  const tables = findInSection(section, "table.wikitable");
  if (tables.length !== 1) {
    throw new ParseError(
      url,
      `h2 "${section.title}" table.wikitable`,
      `expected 1, found ${tables.length}`,
    );
  }
  return readWikitable($, tables.first());
}

function patternTable($: CheerioAPI, section: Section, tab: string, url: string): Wikitable {
  const selector = `h2 "${section.title}" tabber panel ${tab}`;
  const panels = readTabberPanels($, section.content).filter(
    (panel) => panel.path.join("/") === tab,
  );
  const panel = panels[0];
  if (panels.length !== 1 || !panel) {
    throw new ParseError(url, selector, `expected 1, found ${panels.length}`);
  }
  const tables = ownElements($, panel, "table.wikitable");
  if (tables.length !== 1) {
    throw new ParseError(url, `${selector} table.wikitable`, `expected 1, found ${tables.length}`);
  }
  return readWikitable($, tables.first());
}

/** The one title table with a `column` header. */
function titleTable($: CheerioAPI, section: Section, column: string, url: string): Wikitable {
  const tables = findInSection(section, "table.wikitable")
    .toArray()
    .map((table) => readWikitable($, $(table)))
    .filter((table) => table.headers.includes(column));
  if (tables.length !== 1 || !tables[0]) {
    throw new ParseError(
      url,
      `h2 "${section.title}" table.wikitable with "${column}"`,
      `expected 1, found ${tables.length}`,
    );
  }
  return tables[0];
}
