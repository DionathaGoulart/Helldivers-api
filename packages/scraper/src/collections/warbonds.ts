import {
  type Collection,
  type Cost,
  type Dataset,
  type Id,
  type Source,
  slugify,
  Warbond,
} from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { checkSuperstoreSources } from "../link/superstore.ts";
import { type WarbondRef, WarbondRefIndex } from "../link/warbond-items.ts";
import { parseCost } from "../normalize/costs.ts";
import { parseReleaseDate, warbondStem } from "../normalize/warbonds.ts";
import type { RawCost } from "../parsers/raw.ts";
import { parseSuperstore, SUPERSTORE } from "../parsers/superstore.ts";
import { parseWarbondPage, type RawWarbondItem } from "../parsers/warbond-page.ts";
import { parseWarbondsIndex, WARBONDS_INDEX } from "../parsers/warbonds-index.ts";
import { loadHtml } from "../wiki/html.ts";
import { flagsFromCategories, readCanonicalTitle } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Warbonds` galleries + each warbond page (arch §4.3, §5.4). Runs after every item
// collection, so the page table rows resolve against this run's entities (rule 4); prices are
// the table's until `linkWarbondCosts` applies rule 1 over the merged dataset. `/wiki/Superstore`
// is read here too, to check the Superstore sources of those entities (rule 5).

const TYPES = { Standard: "standard", Premium: "premium", Legendary: "legendary" } as const;

const SOURCED = [
  "weapons",
  "stratagems",
  "armors",
  "helmets",
  "capes",
  "boosters",
  "player-cards",
  "emotes",
  "titles",
] as const satisfies readonly Collection[];

/** Every source of the dataset, pattern variants included. */
function sourcesOf(dataset: Dataset): Source[] {
  return [
    ...SOURCED.flatMap((collection) => (dataset[collection] ?? []).map((entity) => entity.source)),
    ...(dataset.patterns ?? []).flatMap((pattern) => pattern.variants.map((v) => v.source)),
  ];
}

export const warbondsPipeline: CollectionPipeline<"warbonds"> = {
  collection: "warbonds",
  indexPages: [WARBONDS_INDEX, SUPERSTORE],

  async scrape({ source, idLock, overrides, logger, dataset }: ScrapeContext) {
    const warnings: string[] = [];
    const index = await source.page(WARBONDS_INDEX);
    const rows = parseWarbondsIndex(index.html, { url: index.url });
    const refs = new WarbondRefIndex(dataset);
    const sources = sourcesOf(dataset);

    const entities: Warbond[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseWarbondPage(page.html, { url: page.url });
      const stem = warbondStem(raw.title);
      if (stem === null) {
        throw new NormalizeError(page.url, raw.title, "not a warbond page title");
      }
      const id = idLock.resolve("warbonds", raw.title, stem);
      const note = (message: string) => warnings.push(`warbonds/${id}: ${message}`);

      const amount = (cost: RawCost | null, fallback: Cost["currency"], field: string) => {
        const text = cost?.text.trim() ?? "";
        if (cost === null || /^none$/i.test(text) || !/\d|^free$/i.test(text)) {
          return null; // no row or `Medals` (unreleased), or `None`
        }
        const parsed = parseCost(cost, page.url, { fallbackCurrency: fallback });
        if (parsed?.currency !== fallback) {
          throw new NormalizeError(page.url, cost.text, `${field} is not in ${fallback}`);
        }
        return parsed.amount;
      };
      const cost = amount(raw.cost, "super_credits", "Cost");
      if (cost === null) {
        throw new NormalizeError(page.url, raw.cost.text, "warbond without a price");
      }

      const typeCategory = raw.categories.find((c) =>
        /^(?:Standard|Premium|Legendary) Warbonds$/.test(c),
      );
      if (typeCategory && typeCategory !== `${row.type} Warbonds`) {
        note(`listed as ${row.type} on ${WARBONDS_INDEX}, category says ${typeCategory}`);
      }

      // Rule 4: a row refers to the entity its link leads to, through a redirect if need be.
      const refOf = async (item: RawWarbondItem): Promise<WarbondRef | null> => {
        if (!refs.covers(item)) {
          return null;
        }
        let candidates = refs.candidates(item);
        if (candidates.length === 0 && item.link) {
          const target = await source.page(item.link.title);
          const canonical = readCanonicalTitle(loadHtml(target.html), target.url);
          candidates = refs.candidates(item, canonical);
        }
        if (candidates.length === 0) {
          note(`"${item.name}" (${item.wikiType}) matches no entity`);
          return null;
        }
        return WarbondRefIndex.refOf(item, candidates, page.url);
      };
      let unannounced = 0;
      const itemCost = (item: RawWarbondItem): Cost | null => {
        if (item.cost.currency && !/\d/.test(item.cost.text)) {
          unannounced += 1;
          return null;
        }
        return parseCost(item.cost, page.url);
      };

      const pages = [];
      for (const listed of raw.pages) {
        const items = [];
        for (const item of listed.items) {
          items.push({
            name: item.name,
            wikiType: item.wikiType,
            ref: await refOf(item),
            cost: itemCost(item),
          });
        }
        pages.push({ number: listed.number, items });
      }
      if (unannounced > 0) {
        note(`${unannounced} item costs not announced`);
      }

      // Names the scraped items and the alias table use for this warbond ("Castellan’s Creed",
      // "Halo: ODST"), without page markers; a label that is the page title is not a new name.
      const aliases = [
        row.name,
        ...sources
          .filter((s) => s.warbondId === id)
          .map((s) => s.label.replace(/\s+P\d+$/, "").trim()),
        ...Object.entries(overrides.warbondAliases)
          .filter(([, aliasId]: [string, Id]) => aliasId === id)
          .map(([label]) => label),
      ];
      const draft = {
        id,
        slug: slugify(raw.name),
        name: raw.name,
        aliases: [...new Set(aliases)]
          .filter((alias) => alias && alias !== raw.name && alias !== raw.title)
          .sort(),
        description: raw.lead,
        image: null, // images arrive in Phase 4
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        type: TYPES[row.type],
        releaseDate: parseReleaseDate(raw.releaseDate, page.url),
        cost: { currency: "super_credits", amount: cost },
        superCreditsClaimable:
          amount(raw.creditsClaimable, "super_credits", "Credits Claimable") ?? 0,
        medalsAllPages: amount(raw.medalsAllPages, "medals", "All Pages Unlocked"),
        medalsAllItems: amount(raw.medalsAllItems, "medals", "All Items Unlocked"),
        pages,
      };
      const warbond = Warbond.safeParse(draft);
      if (!warbond.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(warbond.error));
      }
      if (raw.lead === null) {
        note(`no description on ${page.url}`);
      }
      entities.push(warbond.data);
    }

    const store = await source.page(SUPERSTORE);
    warnings.push(
      ...checkSuperstoreSources(dataset, parseSuperstore(store.html, { url: store.url })),
    );

    logger.info("collection parsed", { collection: "warbonds", count: entities.length });
    return { collection: "warbonds", entities, indexCount: rows.length, warnings, conflicts: [] };
  },
};
