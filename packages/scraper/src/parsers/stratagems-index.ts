import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { readCodeArrows } from "../wiki/stratagem-code.ts";
import { cellAt, columnIndexes, readWikitable } from "../wiki/wikitable.ts";
import { RawCost, RawImage, RawLink } from "./raw.ts";

// `/wiki/Stratagems` (arch §4.3): `h3` Offensive Permit / Supply Permit / Defensive Permit /
// Other › `details` per group (`summary` "Orbital Strikes") › `table.wikitable.sortable`
// `Icon | Name | Stratagem Code | Base Cooldown | Cost | Unlock Level | Source`. The mission
// group has three tables under `big > b` labels (Ship, Objective, Unavailable) and only the
// first four columns.

export const STRATAGEMS_INDEX = "Stratagems";

export const PERMIT_HEADINGS = [
  "Offensive Permit",
  "Supply Permit",
  "Defensive Permit",
  "Other",
] as const;

export const RawStratagemRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  permit: z.enum(PERMIT_HEADINGS), // `h3` above the group
  group: z.string().min(1), // `details > summary`, "Orbital Strikes"
  label: z.string().min(1).nullable(), // `big > b` above the table inside the group, "Objective"
  code: z.array(z.string().min(1)).min(1), // arrow names, "Up"
  cooldown: z.string(),
  cost: RawCost.nullable(), // null when the table has no Cost column
  unlockLevel: z.string().nullable(),
  source: z
    .object({
      label: z.string(), // "Siege Breakers P1", "Bridge"
      link: RawLink.nullable(), // warbond page with `#Page_N`, or a campaign
      pageMarker: z.string().nullable(),
    })
    .nullable(),
  icon: RawImage.nullable(),
});

export type RawStratagemRow = z.infer<typeof RawStratagemRow>;

const REQUIRED = ["Icon", "Name", "Stratagem Code", "Base Cooldown"] as const;

export function parseStratagemsIndex(html: string, { url }: { url: string }): RawStratagemRow[] {
  const $ = loadHtml(html);
  const sections = readSections($, 3);
  const rows: RawStratagemRow[] = [];

  for (const permit of PERMIT_HEADINGS) {
    const matches = sections.filter((section) => section.title === permit);
    if (matches.length !== 1) {
      throw new ParseError(url, `h3 ${permit}`, `expected 1 section, found ${matches.length}`);
    }
    const [section] = matches as [(typeof matches)[number]];
    const groups = findInSection(section, "details");
    if (groups.length === 0) {
      throw new ParseError(url, `h3#${section.id} details`, "no stratagem groups");
    }

    groups.each((g, details) => {
      const group = textOf($(details).children("summary").first());
      const selector = `h3#${section.id} details:eq(${g})`;
      let label: string | null = null;
      let tables = 0;
      for (const node of $(details).find("table.wikitable, big").toArray()) {
        if (node.tagName === "big") {
          label = textOf($(node)) || label;
          continue;
        }
        tables += 1;
        rows.push(...readTable($, $(node), { permit, group, label }, url, `${selector} table`));
      }
      if (tables === 0) {
        throw new ParseError(url, `${selector} table.wikitable`, `no tables in group "${group}"`);
      }
    });
  }
  return rows;
}

function readTable(
  $: CheerioAPI,
  node: Cheerio<Element>,
  context: Pick<RawStratagemRow, "permit" | "group" | "label">,
  url: string,
  selector: string,
): RawStratagemRow[] {
  const table = readWikitable($, node);
  const column = columnIndexes(table, REQUIRED, url, selector);
  const optional = (name: string) => {
    const index = table.headers.indexOf(name);
    return index === -1 ? null : index;
  };
  const costColumn = optional("Cost");
  const levelColumn = optional("Unlock Level");
  const sourceColumn = optional("Source");
  if (table.rows.length === 0) {
    throw new ParseError(url, `${selector} tr`, "no stratagem rows");
  }

  return table.rows.map((row, i) => {
    const rowSelector = `${selector} tr:nth-of-type(${i + 2})`;
    const cell = (index: number) => cellAt(row, index, url, rowSelector);
    const cost = costColumn === null ? null : cell(costColumn);
    const source = sourceColumn === null ? null : cell(sourceColumn);
    return parseRaw(
      RawStratagemRow,
      {
        name: textOf(cell(column.Name)),
        page: firstArticleLink(cell(column.Name)),
        ...context,
        code: readCodeArrows($, cell(column["Stratagem Code"]), url, rowSelector),
        cooldown: textOf(cell(column["Base Cooldown"])),
        cost: cost && { text: textOf(cost), currency: detectCurrency(cost) },
        unlockLevel: levelColumn === null ? null : textOf(cell(levelColumn)),
        source: source && {
          label: textOf(source),
          link: firstArticleLink(source),
          pageMarker: source.find("small .explain[title]").first().attr("title") ?? null,
        },
        icon: firstImage(cell(column.Icon)),
      },
      url,
      rowSelector,
    );
  });
}
