import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { linesOf, loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { RawImage, RawLink } from "./raw.ts";

// `/wiki/Armor_Passives`: one `div.armor-passive-panel` per passive (arch §4.2, §4.3).

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

export function parseArmorPassives(html: string, { url }: { url: string }): RawPassive[] {
  const $ = loadHtml(html);
  const panels = $(PANEL);
  if (panels.length === 0) {
    throw new ParseError(url, PANEL, "no passive panels");
  }

  return panels.toArray().map((element, i) => {
    const panel = $(element);
    const header = panel.find(".armor-passive-header");
    const description = panel.find(".armor-passive-description");
    return parseRaw(
      RawPassive,
      {
        name: textOf(header),
        page: firstArticleLink(header),
        icon: firstImage(header),
        description: textOf(description),
        effects: linesOf(description),
      },
      url,
      `${PANEL}:eq(${i})`,
    );
  });
}
