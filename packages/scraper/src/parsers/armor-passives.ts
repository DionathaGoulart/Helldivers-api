import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { linesOf, loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { readCanonicalTitle } from "../wiki/page.ts";
import { RawImage, RawLink } from "./raw.ts";

// `/wiki/Armor_Passives`: one `div.armor-passive-panel` per passive (arch §4.2, §4.3). A
// passive's own page (`/wiki/True_Grit`) repeats its panel, with a self-link in the header.

export const ARMOR_PASSIVES_INDEX = "Armor Passives";

export const RawPassive = z.object({
  name: z.string().min(1),
  page: RawLink, // the passive's own page, e.g. `/wiki/True_Grit`
  icon: RawImage.nullable(),
  description: z.string().min(1), // every line, joined with a space
  effects: z.array(z.string().min(1)).min(1), // one entry per `<br>`-separated line
});

export type RawPassive = z.infer<typeof RawPassive>;

const PANEL = "#mw-content-text .armor-passive-panel";

function readPanel(
  $: CheerioAPI,
  element: Element,
  page: RawLink | null,
  url: string,
  selector: string,
): RawPassive {
  const panel = $(element);
  const header = panel.find(".armor-passive-header");
  const description = panel.find(".armor-passive-description");
  return parseRaw(
    RawPassive,
    {
      name: textOf(header),
      page: page ?? firstArticleLink(header),
      icon: firstImage(header),
      description: textOf(description),
      effects: linesOf(description),
    },
    url,
    selector,
  );
}

export function parseArmorPassives(html: string, { url }: { url: string }): RawPassive[] {
  const $ = loadHtml(html);
  const panels = $(PANEL);
  if (panels.length === 0) {
    throw new ParseError(url, PANEL, "no passive panels");
  }
  return panels
    .toArray()
    .map((element, i) => readPanel($, element, null, url, `${PANEL}:eq(${i})`));
}

/** The panel of a passive's own page, linked to that page by its canonical title. */
export function parseArmorPassivePage(html: string, { url }: { url: string }): RawPassive {
  const $ = loadHtml(html);
  const panels = $(PANEL);
  const [element] = panels.toArray();
  if (panels.length !== 1 || !element) {
    throw new ParseError(url, PANEL, `expected 1 passive panel, found ${panels.length}`);
  }
  const name = textOf($(element).find(".armor-passive-header"));
  const page = { label: name, title: readCanonicalTitle($, url), anchor: null };
  return readPanel($, element, page, url, PANEL);
}
