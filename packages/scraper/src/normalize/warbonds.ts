import { type Id, slugify } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";

// Warbond resolution, arch §5.5 rule 3: alias table → href target → fail. Aliases come first so
// a link through a redirect (`Helldivers 2 x Killzone Legendary Warbond`) can be re-pointed. The
// ids are not checked here: integrity fails on a warbond id the warbonds collection lacks.

const TITLE_SUFFIX = /\s+(?:(?:Standard|Premium|Legendary)\s+)?Warbond$/i;

/** `Castellan's Creed Legendary Warbond` → `castellans-creed`; null for other pages. */
export function warbondIdFromTitle(title: string): Id | null {
  return TITLE_SUFFIX.test(title) ? slugify(title.replace(TITLE_SUFFIX, "")) : null;
}

/** `Castellan’s Creed P1` → `Castellan's Creed` (curly apostrophe, page marker). */
export function normalizeWarbondLabel(label: string): string {
  return label
    .replaceAll("’", "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+P\d+$/, "");
}

/** Href anchor `Page_3` → 3. */
export function pageFromAnchor(anchor: string | null): number | null {
  const page = /^Page_(\d+)$/.exec(anchor ?? "")?.[1];
  return page ? Number(page) : null;
}

export interface WarbondResolverOptions {
  aliases: Readonly<Record<string, Id>>; // `data/overrides/warbond-aliases.json`
}

export class WarbondResolver {
  readonly #aliases: ReadonlyMap<string, Id>;

  constructor(options: WarbondResolverOptions) {
    this.#aliases = new Map(
      Object.entries(options.aliases).map(([label, id]) => [normalizeWarbondLabel(label), id]),
    );
  }

  resolve(link: { title: string } | null, label: string, page: string): Id {
    const alias = this.#aliases.get(normalizeWarbondLabel(label));
    if (alias) {
      return alias;
    }
    const fromTitle = link ? warbondIdFromTitle(link.title) : null;
    if (fromTitle) {
      return fromTitle;
    }
    throw new NormalizeError(
      page,
      label,
      "unknown warbond; map it in data/overrides/warbond-aliases.json",
    );
  }
}
