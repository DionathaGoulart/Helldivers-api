import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { type DruidRow, readDruid } from "../wiki/druid.ts";
import { linesOf, loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories, readLead } from "../wiki/page.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { linkFromHref } from "../wiki/title.ts";
import { RawCost, RawImage, RawLink } from "./raw.ts";

// `/wiki/<Weapon>` (arch §4.3): DRUID `.druid-container-weapon` / `-throwable` plus the
// detailed statistics tables, found by class wherever the page puts them (the section is
// "Detailed Weapon Statistics" on most pages and "Weapon Statistics" on others):
// `table.attack-data-table-weapon` (weapon rows, extra modes as sections, `Attacks` list)
// and one `table.attack-data-table-<kind>#<id>` per attack. Attack rows point at their
// table through `.remote-trigger[data-target]`.

export const RawText = z.object({
  text: z.string(), // every line joined with a space
  lines: z.array(z.string()), // split on `<br>`
});

export const RawInfoboxRow = RawText.extend({
  key: z.string().min(1), // DRUID row key, `fire_rate`
  label: z.string().min(1),
  links: z.array(RawLink), // article links in the cell (traits)
});

export const RawStatRow = RawText.extend({
  label: z.string().min(1),
  target: z.string().nullable(), // id of the attack table an `Attacks` row points at
});

export const RawStatTable = z.object({
  kind: z.string().min(1), // `attack-data-table-<kind>`: weapon, projectile, explosion…
  id: z.string().nullable(),
  title: z.string().min(1).nullable(), // leading all-`th` row, absent on some pages
  sections: z.array(
    z.object({
      title: z.string().nullable(), // null before the first section row
      rows: z.array(RawStatRow),
    }),
  ),
});

export const RawWeaponPage = z.object({
  title: z.string().min(1), // canonical page title
  name: z.string().min(1), // DRUID title
  container: z.string().nullable(), // "weapon" | "throwable"
  lead: z.string().min(1).nullable(),
  categories: z.array(z.string()),
  image: RawImage.nullable(),
  infobox: z.array(RawInfoboxRow),
  source: z
    .object({
      label: z.string().min(1), // "Python Commandos P1"
      link: RawLink.nullable(),
      pageMarker: z.string().nullable(), // `small .explain[title]`, "Page 1"
    })
    .nullable(),
  cost: RawCost.nullable(),
  // Article links of the "Procurement" section: the only source hint on pages whose
  // infobox has no Source row (CQC-73 Entrenchment Tool).
  procurement: z.array(RawLink),
  tables: z.array(RawStatTable),
});

export type RawText = z.infer<typeof RawText>;
export type RawInfoboxRow = z.infer<typeof RawInfoboxRow>;
export type RawStatRow = z.infer<typeof RawStatRow>;
export type RawStatTable = z.infer<typeof RawStatTable>;
export type RawWeaponPage = z.infer<typeof RawWeaponPage>;

const TABLES = "#mw-content-text table.wikitable[class*='attack-data-table-']";

function rawText(node: Cheerio<Element>): RawText {
  return { text: textOf(node), lines: linesOf(node) };
}

function articleLinks($: CheerioAPI, node: Cheerio<Element>): RawLink[] {
  return node
    .find("a[href]")
    .toArray()
    .flatMap((anchor) => {
      const link = linkFromHref($(anchor).attr("href") ?? "");
      const label = textOf($(anchor));
      return link && label ? [{ label, ...link }] : [];
    });
}

// Stat tables do not fit `readWikitable`: the header row is optional (G/40-K Melta Mine starts
// with data rows), so only a leading all-`th` row is the title and later ones open sections.
function readTables($: CheerioAPI, url: string): RawStatTable[] {
  return $(TABLES)
    .toArray()
    .map((element, i) => {
      const node = $(element);
      const selector = `${TABLES}:eq(${i})`;
      const kind = /\battack-data-table-(\S+)/.exec(node.attr("class") ?? "")?.[1] ?? "";
      let title: string | null = null;
      const sections: RawStatTable["sections"] = [];
      const trs = node
        .find("tr")
        .toArray()
        .filter((tr) => $(tr).closest("table").get(0) === element);
      trs.forEach((tr, r) => {
        const cells = $(tr)
          .children("th, td")
          .toArray()
          .map((cell) => $(cell));
        if (cells.length === 0) {
          return;
        }
        if (cells.every((cell) => cell.is("th"))) {
          const text = cells.map((cell) => textOf(cell)).join(" ");
          if (r === 0) {
            title = text;
          } else {
            sections.push({ title: text, rows: [] });
          }
          return;
        }
        const [label, value] = cells;
        if (!label || !value || cells.length !== 2) {
          throw new ParseError(
            url,
            `${selector} tr:eq(${r})`,
            `expected 2 cells, found ${cells.length}`,
          );
        }
        let section = sections.at(-1);
        if (!section) {
          section = { title: null, rows: [] };
          sections.push(section);
        }
        section.rows.push({
          label: textOf(label).replace(/^\*+/, ""),
          target: label.find(".remote-trigger[data-target]").first().attr("data-target") ?? null,
          ...rawText(value),
        });
      });
      return { kind, id: node.attr("id") ?? null, title, sections };
    });
}

export function parseWeaponPage(html: string, { url }: { url: string }): RawWeaponPage {
  const $ = loadHtml(html);
  const druid = readDruid($, url);
  const row = (key: string): DruidRow | null => druid.rows.get(key) ?? null;

  const source = row("source");
  const cost = row("cost");
  const procurement = readSections($, 2).find((section) => section.title === "Procurement");
  return parseRaw(
    RawWeaponPage,
    {
      title: readCanonicalTitle($, url),
      name: druid.title,
      container: druid.container,
      lead: readLead($),
      categories: readCategories($),
      image: druid.image,
      infobox: [...druid.rows.values()].map((infoboxRow) => ({
        key: infoboxRow.key,
        label: infoboxRow.label,
        links: articleLinks($, infoboxRow.data),
        ...rawText(infoboxRow.data),
      })),
      source: source && {
        label: textOf(source.data),
        link: firstArticleLink(source.data),
        pageMarker: source.data.find("small .explain[title]").first().attr("title") ?? null,
      },
      cost: cost && { text: textOf(cost.data), currency: detectCurrency(cost.data) },
      procurement: procurement ? articleLinks($, findInSection(procurement, "p, li")) : [],
      tables: readTables($, url),
    },
    url,
    "#mw-content-text",
  );
}
