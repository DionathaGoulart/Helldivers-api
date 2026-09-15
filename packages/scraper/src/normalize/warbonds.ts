import { type Id, slugify } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";

// Warbond resolution, arch §5.5 rule 3: href target → alias table → fail.

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
  knownIds: ReadonlySet<Id>;
  aliases: Readonly<Record<string, Id>>; // `data/overrides/warbond-aliases.json`
}

export class WarbondResolver {
  readonly #knownIds: ReadonlySet<Id>;
  readonly #aliases: ReadonlyMap<string, Id>;

  constructor(options: WarbondResolverOptions) {
    this.#knownIds = options.knownIds;
    this.#aliases = new Map(
      Object.entries(options.aliases).map(([label, id]) => [normalizeWarbondLabel(label), id]),
    );
  }

  resolve(link: { title: string } | null, label: string, page: string): Id {
    const fromTitle = link ? warbondIdFromTitle(link.title) : null;
    if (fromTitle && this.#knownIds.has(fromTitle)) {
      return fromTitle;
    }
    const alias = this.#aliases.get(normalizeWarbondLabel(label));
    if (alias && this.#knownIds.has(alias)) {
      return alias;
    }
    const tried = [fromTitle && `id ${fromTitle}`, alias && `alias ${alias}`].filter(Boolean);
    throw new NormalizeError(
      page,
      label,
      `unknown warbond${tried.length ? ` (${tried.join(", ")} not a known warbond)` : ""}; map it in data/overrides/warbond-aliases.json`,
    );
  }
}
