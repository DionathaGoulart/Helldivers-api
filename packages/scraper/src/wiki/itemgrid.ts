import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { detectCurrency } from "./currency.ts";
import { textOf } from "./html.ts";
import { firstArticleLink, firstImage, type ImageRef, type LabeledLink } from "./links.ts";

// Item grids (arch §4.2): `div.hd2-itemgrid` › `.hd2-itembox` › `.hd2-itembox-img` +
// `.hd2-title a` + a last `span` = `<source> [<small>Pn</small>] [| <cost>]`. The cost part
// has its own links (`Medals`), so the source is read only from the nodes before the `|`.

export interface ItemBox {
  name: string; // `.hd2-title` text
  page: LabeledLink | null;
  image: ImageRef | null;
  source: {
    label: string; // "Helldivers Mobilize! P1"
    link: LabeledLink | null;
    pageMarker: string | null; // `small .explain[title]`, "Page 1"
  } | null; // null when the span is empty
  cost: { text: string; currency: ReturnType<typeof detectCurrency> } | null; // null without `|`
}

const SEPARATOR = "|";

// `append` parses strings as HTML; text split out of a node must stay text.
const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The nodes of `span` before and after its first `|`, each wrapped in a detached `span`. */
function splitOnSeparator($: CheerioAPI, span: Cheerio<Element>) {
  const before = $("<span></span>");
  const after = $("<span></span>");
  let found = false;
  for (const node of span.contents().toArray() as AnyNode[]) {
    if (!found && node.type === "text" && node.data.includes(SEPARATOR)) {
      const at = node.data.indexOf(SEPARATOR);
      before.append(escapeHtml(node.data.slice(0, at)));
      after.append(escapeHtml(node.data.slice(at + SEPARATOR.length)));
      found = true;
      continue;
    }
    (found ? after : before).append($(node).clone());
  }
  return { before, after: found ? after : null };
}

/** Every `.hd2-itembox` in `boxes`, in document order. */
export function readItemBoxes($: CheerioAPI, boxes: Cheerio<Element>): ItemBox[] {
  return boxes.toArray().map((element) => {
    const box = $(element);
    const title = box.children(".hd2-title").first();
    const span = box.children("span:not([class])").last();
    const { before, after } = splitOnSeparator($, span);
    const label = textOf(before);
    return {
      name: textOf(title),
      page: firstArticleLink(title),
      image: firstImage(box.children(".hd2-itembox-img").first()),
      source: label
        ? {
            label,
            link: firstArticleLink(before),
            pageMarker: before.find("small .explain[title]").first().attr("title") ?? null,
          }
        : null,
      cost: after ? { text: textOf(after), currency: detectCurrency(after) } : null,
    };
  });
}
