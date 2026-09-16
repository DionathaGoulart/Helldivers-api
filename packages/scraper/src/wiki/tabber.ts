import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { textOf } from "./html.ts";

// TabberNeue (arch §4.2): every panel ships in the HTML. Panel ids repeat a label with a
// page-wide counter (`Special-0`, `Special-1`, `Special-2`), so a panel is identified by the
// chain of tab labels above it, never by its id.

const PANEL = "article.tabber__panel";

export interface TabberPanel {
  id: string; // "Special-1"
  label: string; // "Special", the text of its tab
  path: string[]; // ["Secondary", "Special"], outermost tab first
  node: Cheerio<Element>;
}

function labelOf($: CheerioAPI, panel: Cheerio<Element>): string {
  const id = panel.attr("id") ?? "";
  const tab = panel
    .closest(".tabber")
    .children(".tabber__header")
    .find("a.tabber__tab")
    .filter((_, element) => $(element).attr("aria-controls") === id);
  return textOf(tab.first());
}

/** Every tabber panel under `root`, in document order. */
export function readTabberPanels($: CheerioAPI, root: Cheerio<AnyNode>): TabberPanel[] {
  return root
    .find(PANEL)
    .toArray()
    .map((element) => {
      const node = $(element);
      const ancestors = node
        .parents(PANEL)
        .toArray()
        .reverse()
        .map((ancestor) => labelOf($, $(ancestor)));
      const label = labelOf($, node);
      return { id: node.attr("id") ?? "", label, path: [...ancestors, label], node };
    });
}

/** Matches of `selector` inside `panel` that are not inside one of its nested panels. */
export function ownElements($: CheerioAPI, panel: TabberPanel, selector: string): Cheerio<Element> {
  const own = panel.node.get(0);
  return panel.node.find(selector).filter((_, element) => $(element).closest(PANEL).get(0) === own);
}
