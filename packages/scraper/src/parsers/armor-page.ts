import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { detectCurrency } from "../wiki/currency.ts";
import { druidData, readDruid } from "../wiki/druid.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { readCanonicalTitle, readCategories, readLead } from "../wiki/page.ts";
import { RawCost, RawImage, RawSourceCell } from "./raw.ts";
import { articleLinks, RawInfoboxRow, rawText } from "./weapon-page.ts";

// Armory pages (arch §4.3): an armor set (`/wiki/TG-8_Sharpshooter`, DRUID tabs `Body Armor` /
// `Helmet`), a standalone helmet (`/wiki/IX-Voidwalker`, tab `Helmet`), a cape with its player
// card (`/wiki/City_Fighter's_Resolve`, tabs `Cape` / `Player Card`) or a cape alone
// (`/wiki/Foesmasher`, no tabs). Rows that do not vary by tab apply to every tab. The in-game
// text is a quote attributed to the "Armory description" above the lead.

export const RawArmoryTab = z.object({
  name: z.string().min(1).nullable(), // `data-druid-tab-key`; null on pages without tabs
  rows: z.array(RawInfoboxRow), // rows with data for this tab
  source: RawSourceCell.nullable(),
  cost: RawCost.nullable(),
  image: RawImage.nullable(),
});

export const RawArmoryPage = z.object({
  title: z.string().min(1), // canonical page title
  name: z.string().min(1), // DRUID title
  lead: z.string().min(1).nullable(),
  armoryDescription: z.string().min(1).nullable(),
  categories: z.array(z.string()),
  tabs: z.array(RawArmoryTab).min(1),
});

export type RawArmoryTab = z.infer<typeof RawArmoryTab>;
export type RawArmoryPage = z.infer<typeof RawArmoryPage>;

const QUOTE = "#mw-content-text > .mw-parser-output > blockquote";
const ATTRIBUTION = /^—\s*Armory\b/i; // "— Armory description", "— Armory cape description"

/** Paragraphs of the first quote attributed to the Armory, without the attribution. */
function readArmoryDescription($: CheerioAPI): string | null {
  for (const quote of $(QUOTE).toArray()) {
    const paragraphs = $(quote)
      .find("p")
      .toArray()
      .map((paragraph) => textOf($(paragraph)));
    if (paragraphs.some((text) => ATTRIBUTION.test(text))) {
      return paragraphs.filter((text) => text && !ATTRIBUTION.test(text)).join(" ") || null;
    }
  }
  return null;
}

export function parseArmorPage(html: string, { url }: { url: string }): RawArmoryPage {
  const $ = loadHtml(html);
  const druid = readDruid($, url);
  const names = druid.tabs.length > 0 ? druid.tabs : [null];

  const tabs = names.map((tab) => {
    const rows = [...druid.rows.values()].flatMap((row) => {
      const data = druidData(row, tab);
      if (!data || !textOf(data)) {
        return [];
      }
      return [{ key: row.key, label: row.label, links: articleLinks($, data), ...rawText(data) }];
    });
    const cell = (key: string) => {
      const row = druid.rows.get(key);
      const data = row ? druidData(row, tab) : null;
      return data && textOf(data) ? data : null;
    };
    const source = cell("source");
    const cost = cell("cost");
    return {
      name: tab,
      rows,
      source: source && {
        label: textOf(source),
        link: firstArticleLink(source),
        pageMarker: source.find("small .explain[title]").first().attr("title") ?? null,
      },
      cost: cost && { text: textOf(cost), currency: detectCurrency(cost) },
      image: (tab === null ? druid.image : druid.tabImages.get(tab)) ?? null,
    };
  });
  if (tabs.every((tab) => tab.rows.length === 0)) {
    throw new ParseError(url, "#mw-content-text .druid-infobox .druid-row", "no infobox rows");
  }

  return parseRaw(
    RawArmoryPage,
    {
      title: readCanonicalTitle($, url),
      name: druid.title,
      lead: readLead($),
      armoryDescription: readArmoryDescription($),
      categories: readCategories($),
      tabs,
    },
    url,
    "#mw-content-text",
  );
}

/** The tab named `name`, or the only tab of a page without tabs. */
export function armoryTab(page: RawArmoryPage, name: string): RawArmoryTab | null {
  return (
    page.tabs.find((tab) => tab.name === name) ??
    (page.tabs.length === 1 && page.tabs[0]?.name === null ? page.tabs[0] : null)
  );
}
