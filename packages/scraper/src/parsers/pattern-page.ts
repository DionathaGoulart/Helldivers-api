import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { parseArmorPage } from "./armor-page.ts";
import { RawCost, RawImage, RawSourceCell } from "./raw.ts";

// Vehicle pattern pages (arch §4.3, `/wiki/Castellans_Green_Pattern`): the same DRUID tabbed
// infobox as armory pages, one tab per vehicle with its own `source` (warbond link with a
// `#Page_N` anchor) and `cost`. Tab `FRV` is the Cosmetics `Vehicle Cost` column (arch §4.5).

export const PATTERN_TABS = {
  Shuttle: "shuttle",
  Hellpod: "hellpod",
  Exosuit: "exosuit",
  FRV: "vehicle",
} as const;

// Standard Pattern's `Tank` tab says "Free with the FRV pattern"; Cosmetics has no column for it.
const IGNORED_TABS: readonly string[] = ["Tank"];

export const RawPatternVariant = z.object({
  tab: z.string().min(1), // DRUID tab, "FRV"
  target: z.enum(Object.values(PATTERN_TABS)),
  source: RawSourceCell.nullable(),
  cost: RawCost.nullable(),
  image: RawImage.nullable(),
});

export const RawPatternPage = z.object({
  title: z.string().min(1), // canonical page title, "Castellans Green Pattern"
  name: z.string().min(1), // DRUID title, "Castellans Green"
  lead: z.string().min(1).nullable(),
  categories: z.array(z.string()),
  variants: z.array(RawPatternVariant).min(1),
});

export type RawPatternVariant = z.infer<typeof RawPatternVariant>;
export type RawPatternPage = z.infer<typeof RawPatternPage>;

export function parsePatternPage(html: string, { url }: { url: string }): RawPatternPage {
  const page = parseArmorPage(html, { url });
  const variants = page.tabs.flatMap((tab) => {
    if (tab.name !== null && IGNORED_TABS.includes(tab.name)) {
      return [];
    }
    const target =
      tab.name === null ? undefined : PATTERN_TABS[tab.name as keyof typeof PATTERN_TABS];
    if (!target || tab.name === null) {
      throw new ParseError(
        url,
        ".druid-tab[data-druid-tab-key]",
        `unknown pattern tab ${JSON.stringify(tab.name)}`,
      );
    }
    return [{ tab: tab.name, target, source: tab.source, cost: tab.cost, image: tab.image }];
  });

  return parseRaw(
    RawPatternPage,
    {
      title: page.title,
      name: page.name,
      lead: page.lead,
      categories: page.categories,
      variants,
    },
    url,
    "#mw-content-text .druid-infobox",
  );
}
