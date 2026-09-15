import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories } from "../wiki/page.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawLink } from "./raw.ts";

// `/wiki/Equipment_Traits` (arch §4.3): the `#All_Traits` list ("Explosive- 63 unique gear
// items") and, per trait, an `h3` + `table.wikitable` `Page Name | Name | Type | Trait`.

export const EQUIPMENT_TRAITS_INDEX = "Equipment Traits";

export const RawTraitListing = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative(), // "unique gear items"
});

export const RawTraitMember = z.object({
  page: RawLink,
  name: z.string().min(1), // in-game name: page `CQC-72 Entrenchment Tool` is `Trench Shovel`
  type: z.enum(["Weapon", "Stratagem"]),
});

export const RawTrait = z.object({
  name: z.string().min(1),
  anchor: z.string().min(1), // heading id, `Light_Armor_Penetrating`
  members: z.array(RawTraitMember),
});

export const RawEquipmentTraits = z.object({
  title: z.string().min(1), // canonical title of the page
  categories: z.array(z.string()),
  listed: z.array(RawTraitListing).min(1),
  traits: z.array(RawTrait).min(1),
});

export type RawTraitListing = z.infer<typeof RawTraitListing>;
export type RawTraitMember = z.infer<typeof RawTraitMember>;
export type RawTrait = z.infer<typeof RawTrait>;
export type RawEquipmentTraits = z.infer<typeof RawEquipmentTraits>;

const LIST_SECTION = "All_Traits";
const LISTING = /^(.+?)\s*-\s*(\d+) unique gear items?$/;
const TABLE = "table.wikitable";
const COLUMNS = ["Page Name", "Name", "Type", "Trait"] as const;

export function parseEquipmentTraits(html: string, { url }: { url: string }): RawEquipmentTraits {
  const $ = loadHtml(html);

  const list = readSections($, 2).find((section) => section.id === LIST_SECTION);
  const items = list ? findInSection(list, "ol").first().children("li") : null;
  if (!items || items.length === 0) {
    throw new ParseError(url, `#${LIST_SECTION} ol li`, "no trait list");
  }
  const listed = items.toArray().map((item, i) => {
    const selector = `#${LIST_SECTION} ol li:eq(${i})`;
    const text = textOf($(item));
    const match = LISTING.exec(text);
    if (!match) {
      throw new ParseError(url, selector, `unexpected entry ${JSON.stringify(text)}`);
    }
    return parseRaw(RawTraitListing, { name: match[1], count: Number(match[2]) }, url, selector);
  });

  const sections = readSections($, 3);
  if (sections.length === 0) {
    throw new ParseError(url, `h3 + ${TABLE}`, "no trait tables");
  }
  const traits = sections.map((section) => {
    const selector = `${TABLE} under h3#${section.id}`;
    const tables = findInSection(section, TABLE);
    if (tables.length !== 1) {
      throw new ParseError(url, selector, `expected 1 table, found ${tables.length}`);
    }
    const table = readWikitable($, tables.first());
    const column = columnIndexes(table, COLUMNS, url, selector);
    const members = table.rows.map((row, i) => {
      const rowSelector = `${selector} tr:eq(${i + 1})`;
      const cell = (name: (typeof COLUMNS)[number]) => cellAt(row, column[name], url, rowSelector);
      // A row naming another trait means the heading ⇄ table pairing broke.
      const trait = textOf(cell("Trait"));
      if (trait !== section.title) {
        throw new ParseError(url, rowSelector, `row lists trait ${JSON.stringify(trait)}`);
      }
      return parseRaw(
        RawTraitMember,
        {
          page: firstArticleLink(cell("Page Name")),
          name: textOf(cell("Name")),
          type: textOf(cell("Type")),
        },
        url,
        rowSelector,
      );
    });
    return { name: section.title, anchor: section.id, members };
  });

  return parseRaw(
    RawEquipmentTraits,
    { title: readCanonicalTitle($, url), categories: readCategories($), listed, traits },
    url,
    "#mw-content-text",
  );
}
