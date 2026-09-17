import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { textOf } from "./html.ts";
import { linkFromHref, type WikiLink } from "./title.ts";

export interface LabeledLink extends WikiLink {
  label: string; // link text as shown
}

export interface ImageRef {
  file: string; // wiki file name, e.g. "Hellpod_Space_Optimization_Booster_Icon.svg"
  src: string; // as served, with the version suffix (`?7aa15a`)
  width: number | null; // size of the original file (`data-file-width`), not of the thumbnail
  height: number | null;
}

const NAMESPACED = /^(?:File|Category|Special|Template|MediaWiki):/i;

/**
 * First text link to an article (not a file, category or special page) inside `node`.
 * Icon-only links to the same article (`<a><img></a> <a>True Grit</a>`) are skipped.
 */
export function firstArticleLink(node: Cheerio<AnyNode>): LabeledLink | null {
  const anchors = node.find("a[href]");
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors.eq(i);
    const link = linkFromHref(anchor.attr("href") ?? "");
    const label = textOf(anchor);
    if (link && label && !NAMESPACED.test(link.title)) {
      return { label, ...link };
    }
  }
  return null;
}

/** `/images/thumb/A.png/51px-A.png?x` and `/images/A.svg?x` → the file name. */
export function fileFromSrc(src: string): string | null {
  const path = src.split(/[?#]/)[0] ?? "";
  const match = /^\/images\/thumb\/([^/]+)\/[^/]+$/.exec(path) ?? /^\/images\/([^/]+)$/.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const fileSize = (value: string | undefined) =>
  value && /^\d+$/.test(value) ? Number(value) : null;

export function firstImage(node: Cheerio<AnyNode>): ImageRef | null {
  const img = node.find("img[src]").first();
  const src = img.attr("src");
  const file = src ? fileFromSrc(src) : null;
  if (!src || !file) {
    return null;
  }
  return {
    file,
    src,
    width: fileSize(img.attr("data-file-width")),
    height: fileSize(img.attr("data-file-height")),
  };
}
