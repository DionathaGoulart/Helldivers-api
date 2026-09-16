import { WikiFlag } from "@hd2/schemas";
import type { CheerioAPI } from "cheerio";
import { ParseError } from "../errors.ts";
import { textOf } from "./html.ts";
import { linkFromHref } from "./title.ts";

// Page-level facts shared by every article parser (arch §4.2: lead, categories, canonical).

const BODY = "#mw-content-text > .mw-parser-output";

/** Title from `link[rel=canonical]`: a redirected page reports its target (arch §5.5 rule 8). */
export function readCanonicalTitle($: CheerioAPI, page: string): string {
  const href = $("link[rel='canonical']").attr("href");
  const link = href ? linkFromHref(href) : null;
  if (!link) {
    throw new ParseError(page, "link[rel=canonical]", "missing or not a wiki article");
  }
  return link.title;
}

/** First non-empty paragraph of the article body. */
export function readLead($: CheerioAPI): string | null {
  for (const paragraph of $(`${BODY} > p`).toArray()) {
    const text = textOf($(paragraph));
    if (text) {
      return text;
    }
  }
  return null;
}

/** Visible and hidden category names, in page order. */
export function readCategories($: CheerioAPI): string[] {
  return $("#catlinks .mw-normal-catlinks li, #catlinks .mw-hidden-catlinks li")
    .toArray()
    .map((item) => textOf($(item)));
}

const FLAG_BY_CATEGORY: Readonly<Record<string, WikiFlag>> = {
  "Potentially Outdated Pages": "potentially_outdated",
  "Pages with broken file links": "broken_file_links",
  Stubs: "stub", // confirmed on Castellans Green Pattern (plan 3e)
};

/** Maintenance categories → `wiki.flags`, in enum order (arch §4.5). */
export function flagsFromCategories(categories: readonly string[]): WikiFlag[] {
  const flags = new Set(categories.map((category) => FLAG_BY_CATEGORY[category]));
  return WikiFlag.options.filter((flag) => flags.has(flag));
}
