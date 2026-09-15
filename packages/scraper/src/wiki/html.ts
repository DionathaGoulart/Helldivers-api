import type { Cheerio, CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

// Scraped HTML is only ever read as text (prd NFR-08).

export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}

const NOISE = "sup.reference, .mw-editsection, style, script";
const BREAK = ""; // private-use marker for <br>; `\s` does not match it

function visibleText(node: Cheerio<AnyNode>): string {
  const copy = node.clone();
  copy.find(NOISE).remove();
  copy.find("br").replaceWith(BREAK);
  return copy.text();
}

/** Text with every whitespace run, `<br>` included, collapsed to one space. */
export function textOf(node: Cheerio<AnyNode>): string {
  return visibleText(node).replaceAll(BREAK, " ").replace(/\s+/g, " ").trim();
}

/** Text split on `<br>`, each line collapsed; empty lines dropped. */
export function linesOf(node: Cheerio<AnyNode>): string[] {
  return visibleText(node)
    .split(BREAK)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
