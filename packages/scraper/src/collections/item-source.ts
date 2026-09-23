import type { Cost, Currency, Id, Passive, Source, WeaponTrait } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import { parseCost } from "../normalize/costs.ts";
import { classifySource, type RawSourceCell } from "../normalize/sources.ts";
import type { RawCost, RawLink } from "../parsers/raw.ts";
import { findItem, parseWarbondPage, type RawWarbondPage } from "../parsers/warbond-page.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { ScrapeContext } from "./types.ts";

// Acquisition and references shared by item pipelines: the `Source` of an item page (arch §5.5
// rule 3), its `Equipment Traits` links (weapons, stratagems) and its passive (armors).

export interface ItemSourceInput {
  cell: RawSourceCell;
  cost: RawCost | null; // the item page's cost row
  titles: readonly string[]; // titles a warbond page table may link the item by
  wikiType?: string; // warbond table type when rows of other types link the same page ("Helmet")
  itemName?: string; // warbond row name when rows of one type link the same page (rule 10)
  page: string; // item page URL
  fallbackCurrency?: Currency; // requisition columns that only say `Free`
  note: (message: string) => void;
}

/** Resolves item sources, reading each warbond page once per run. */
export function itemSourceResolver({ source, overrides, warbonds }: ScrapeContext) {
  const warbondPages = new Map<string, RawWarbondPage>();
  const warbondPage = async (title: string) => {
    let warbond = warbondPages.get(title);
    if (!warbond) {
      const page = await source.page(title);
      warbond = parseWarbondPage(page.html, { url: page.url });
      warbondPages.set(title, warbond);
    }
    return warbond;
  };

  return async function resolveSource(input: ItemSourceInput): Promise<Source> {
    const { cell, page, note } = input;
    const kind = classifySource(cell, {
      warbonds,
      sourceLabels: overrides.sourceLabels,
      page,
    });
    const options = input.fallbackCurrency ? { fallbackCurrency: input.fallbackCurrency } : {};
    const readCost = (rawCost: RawCost | null, url: string): Cost | null => {
      if (!rawCost) return null;
      if (!/\d/.test(rawCost.text) && rawCost.currency) {
        note(`cost not announced (${JSON.stringify(rawCost.text)})`);
        return null;
      }
      return parseCost(rawCost, url, options);
    };

    let cost = readCost(input.cost, page);
    let sourcePage = kind.page;
    if (kind.type === "warbond" && (sourcePage === null || !input.cost) && cell.link) {
      // Rule 3: the warbond page table that lists the item gives the page (and the cost when
      // the item page has none).
      const warbond = await warbondPage(cell.link.title);
      let listed: ReturnType<typeof findItem> = null;
      for (const title of input.titles) {
        listed ??= findItem(warbond, title, input.wikiType ?? null, input.itemName ?? null);
      }
      if (!listed) {
        throw new NormalizeError(page, cell.label, `no page lists it on ${cell.link.title}`);
      }
      sourcePage ??= listed.page;
      if (!input.cost) {
        cost = readCost(listed.item.cost, wikiUrl(warbond.title));
      }
    }

    return {
      type: kind.type,
      label: cell.label,
      warbondId: kind.warbondId,
      page: sourcePage,
      cost,
      rotating: kind.type === "superstore" ? false : null, // arch §4.5: no rotation left
    };
  };
}

/**
 * Trait links (`/wiki/Equipment_Traits#<anchor>`) → weapon-trait ids; the collection must be
 * scraped first. `aliases` (data/overrides/trait-aliases.json) maps a misspelled heading the
 * wiki links to the trait it stands for.
 */
export function traitResolver(
  traits: readonly WeaponTrait[] | undefined,
  collection: "weapons" | "stratagems",
  aliases: Readonly<Record<string, Id>>,
) {
  if (!traits) {
    throw new Error(`${collection} need the weapon-traits collection: scrape weapon-traits first`);
  }
  const byAnchor = traitAnchors(traits, aliases);
  return (links: readonly RawLink[], page: string): Id[] => [
    ...new Set(
      links.map((link) => {
        const trait =
          link.title === "Equipment Traits" && link.anchor ? byAnchor.get(link.anchor) : null;
        if (!trait) {
          throw new NormalizeError(page, link.label, "unknown equipment trait");
        }
        return trait;
      }),
    ),
  ];
}

/** Passive links (`/wiki/True_Grit`) → passive ids; the collection must be scraped first. */
export function passiveResolver(passives: readonly Passive[] | undefined) {
  if (!passives) {
    throw new Error("armors need the passives collection: scrape passives first");
  }
  const byTitle = new Map(passives.map((passive) => [passive.wiki.title, passive.id]));
  return (link: RawLink, page: string): Id => {
    const passive = byTitle.get(link.title);
    if (!passive) {
      throw new NormalizeError(page, link.label, "unknown armor passive");
    }
    return passive;
  };
}

/** Heading anchor → trait id: the anchors of `wiki.url` plus the aliased misspellings. */
export function traitAnchors(
  traits: readonly WeaponTrait[],
  aliases: Readonly<Record<string, Id>>,
): Map<string, Id> {
  const byAnchor = new Map(
    traits.map((trait) => [decodeURIComponent(new URL(trait.wiki.url).hash.slice(1)), trait.id]),
  );
  const ids = new Set(traits.map((trait) => trait.id));
  for (const [anchor, id] of Object.entries(aliases)) {
    if (!ids.has(id)) {
      throw new Error(`data/overrides/trait-aliases.json: "${anchor}" is not a trait id: ${id}`);
    }
    byAnchor.set(anchor, id);
  }
  return byAnchor;
}
