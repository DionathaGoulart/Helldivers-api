import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { ParseError } from "../errors.ts";

// Stratagem codes are arrow icons (arch §4.3): `span.Stratagemcodeicon img[alt="Stratagem Arrow Up.svg"]`.

const ARROW = "span.Stratagemcodeicon img";

/** Arrow names in input order: `Stratagem Arrow Up.svg` → `Up`. */
export function readCodeArrows(
  $: CheerioAPI,
  cell: Cheerio<AnyNode>,
  page: string,
  selector: string,
): string[] {
  return cell
    .find(ARROW)
    .toArray()
    .map((img) => {
      const alt = $(img).attr("alt") ?? "";
      const arrow = /^Stratagem Arrow (\S+)\.svg$/.exec(alt)?.[1];
      if (!arrow) {
        throw new ParseError(page, `${selector} ${ARROW}`, `unexpected arrow icon "${alt}"`);
      }
      return arrow;
    });
}
