import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink } from "../wiki/links.ts";
import { findInSection, readSections } from "../wiki/sections.ts";
import { RawLink } from "./raw.ts";

// `/wiki/Warbonds` (arch §4.3): `h3#Standard | #Premium | #Legendary` › `.Custom_gallery`
// `li.gallerybox .gallerytext a`. The gallery nests a `.gallery` inside `.Custom_gallery`, so
// each box is matched once by element. Links may go through a redirect (`Democratic Detonation`).

export const WARBONDS_INDEX = "Warbonds";

export const WARBOND_TYPE_SECTIONS = ["Standard", "Premium", "Legendary"] as const;

export const RawWarbondRow = z.object({
  name: z.string().min(1), // gallery caption, "Castellan's Creed"
  page: RawLink,
  type: z.enum(WARBOND_TYPE_SECTIONS),
});

export type RawWarbondRow = z.infer<typeof RawWarbondRow>;

const ITEM = "li.gallerybox";

export function parseWarbondsIndex(html: string, { url }: { url: string }): RawWarbondRow[] {
  const $ = loadHtml(html);
  const sections = readSections($, 3);

  return WARBOND_TYPE_SECTIONS.flatMap((type) => {
    const selector = `h3#${type} ${ITEM}`;
    const matches = sections.filter((section) => section.id === type);
    if (matches.length !== 1 || !matches[0]) {
      throw new ParseError(url, `h3#${type}`, `expected 1 section, found ${matches.length}`);
    }
    const items = findInSection(matches[0], ITEM);
    if (items.length === 0) {
      throw new ParseError(url, selector, "no warbonds");
    }
    return items.toArray().map((element, i) => {
      const caption = $(element).find(".gallerytext");
      return parseRaw(
        RawWarbondRow,
        { name: textOf(caption), page: firstArticleLink(caption), type },
        url,
        `${selector}:eq(${i})`,
      );
    });
  });
}
