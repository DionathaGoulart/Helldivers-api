import { z } from "zod";
import { parseRaw } from "../errors.ts";
import { loadHtml } from "../wiki/html.ts";
import { readCanonicalTitle, readCategories, readLead } from "../wiki/page.ts";

// `/wiki/<Booster>`: no infobox; the lead paragraph is the description (arch §4.3).

export const RawBoosterPage = z.object({
  title: z.string().min(1),
  lead: z.string().min(1).nullable(),
  categories: z.array(z.string()),
});

export type RawBoosterPage = z.infer<typeof RawBoosterPage>;

export function parseBoosterPage(html: string, { url }: { url: string }): RawBoosterPage {
  const $ = loadHtml(html);
  return parseRaw(
    RawBoosterPage,
    { title: readCanonicalTitle($, url), lead: readLead($), categories: readCategories($) },
    url,
    "#mw-content-text",
  );
}
