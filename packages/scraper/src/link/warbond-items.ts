import {
  type Conflict,
  type Cost,
  type Dataset,
  type Id,
  PatternTarget,
  type Source,
  type WarbondItem,
  WarbondRefCollection,
} from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";

// Warbond items ⇄ entities (arch §5.5 rules 1, 4 and 10). The warbonds pipeline runs after every
// item collection and matches each page table row to an entity by href (the page a redirect
// lands on when the link title matches nothing), or by name on rows without a link (titles);
// the row type only narrows the collections, since armor, helmet and set, or cape and player
// card, share a page. `linkWarbondCosts` then makes a row and the entity it sources agree on the
// price (rule 1).

export type WarbondRef = NonNullable<WarbondItem["ref"]>;

export interface WarbondRow {
  name: string; // "Castellans Green Hellpod"
  wikiType: string; // "Pattern", "Medium Armor", "Assault Rifle"
  link: { title: string } | null;
}

const TYPE_COLLECTIONS: Readonly<Record<string, WarbondRefCollection>> = {
  Helmet: "helmets",
  Cape: "capes",
  "Player Card": "player-cards",
  Pattern: "patterns",
  Emote: "emotes",
  "Victory Pose": "emotes",
  Title: "titles",
  Booster: "boosters",
};

// Every other type names a weapon ("Assault Rifle", "Special Throwable") or a stratagem
// ("Support Weapon", "Backpack", "Sentry", "Mortar"), and the wiki keeps adding spellings.
const EQUIPMENT: readonly WarbondRefCollection[] = ["weapons", "stratagems"];

/** Collections a row type can refer to; null for `Currency` rows ("100 Super Credits"). */
export function collectionsOfType(wikiType: string): readonly WarbondRefCollection[] | null {
  if (wikiType === "Currency") {
    return null;
  }
  if (/ Armor$/.test(wikiType)) {
    return ["armors"];
  }
  const collection = TYPE_COLLECTIONS[wikiType];
  return collection ? [collection] : EQUIPMENT;
}

/** Straight quotes, single spaces: `AX/TX-13 “Guard Dog” Dog Breath`. */
const matchKey = (text: string) =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

const VARIANT_SUFFIX = / (Hellpod|Shuttle|Exosuit|Vehicle)$/; // rule 10

interface Candidate {
  collection: WarbondRefCollection;
  id: Id;
}

export class WarbondRefIndex {
  readonly #collections: ReadonlySet<WarbondRefCollection>;
  readonly #byTitle = new Map<string, Candidate[]>();
  readonly #byName = new Map<string, Candidate[]>();

  constructor(dataset: Dataset) {
    const add = (map: Map<string, Candidate[]>, key: string, candidate: Candidate) => {
      const list = map.get(matchKey(key)) ?? [];
      if (!list.some((c) => c.collection === candidate.collection && c.id === candidate.id)) {
        list.push(candidate);
      }
      map.set(matchKey(key), list);
    };
    this.#collections = new Set(WarbondRefCollection.options.filter((c) => dataset[c]));
    for (const collection of this.#collections) {
      for (const entity of dataset[collection] ?? []) {
        const candidate = { collection, id: entity.id };
        // Index-only rows without a page of their own point at an anchor of the index
        // (weapon patterns: `Cosmetics#Patterns`), which identifies nothing.
        if (!new URL(entity.wiki.url).hash) {
          add(this.#byTitle, entity.wiki.title, candidate);
        }
        for (const alias of entity.aliases) {
          add(this.#byTitle, alias, candidate);
          add(this.#byName, alias, candidate);
        }
        add(this.#byName, entity.name, candidate);
      }
    }
  }

  /** Whether any collection the row type can refer to is in the dataset. */
  covers(row: WarbondRow): boolean {
    return (collectionsOfType(row.wikiType) ?? []).some((c) => this.#collections.has(c));
  }

  /** Entities the row can refer to: by `title` (its link, or where the link redirects), else by name. */
  candidates(row: WarbondRow, title: string | null = row.link?.title ?? null): Candidate[] {
    const allowed = collectionsOfType(row.wikiType) ?? [];
    const found =
      title === null ? this.#byName.get(matchKey(row.name)) : this.#byTitle.get(matchKey(title));
    return (found ?? []).filter((candidate) => allowed.includes(candidate.collection));
  }

  /** The ref of a row with exactly one candidate; patterns take the variant from the row name. */
  static refOf(row: WarbondRow, candidates: readonly Candidate[], page: string): WarbondRef {
    const [candidate, ...others] = candidates;
    if (!candidate || others.length > 0) {
      const names = candidates.map((c) => `${c.collection}/${c.id}`).join(", ");
      throw new NormalizeError(page, row.name, `ambiguous warbond row (${row.wikiType}): ${names}`);
    }
    if (candidate.collection !== "patterns") {
      return { ...candidate, variant: null };
    }
    const suffix = VARIANT_SUFFIX.exec(row.name)?.[1];
    if (!suffix) {
      throw new NormalizeError(
        page,
        row.name,
        "pattern row without a Hellpod/Shuttle/Exosuit/Vehicle suffix",
      );
    }
    return { ...candidate, variant: PatternTarget.parse(suffix.toLowerCase()) };
  }
}

interface Sourced {
  id: Id;
  wiki: { url: string };
  source: Source;
}

const sameCost = (a: Cost | null, b: Cost | null) =>
  a?.currency === b?.currency && a?.amount === b?.amount;

const medals = (cost: Cost | null) => (cost?.currency === "medals" ? cost.amount : null);

export interface WarbondCosts {
  dataset: Dataset;
  conflicts: Conflict[];
  warnings: string[];
}

/**
 * Rule 1 between each warbond row and the entity whose source is that row (same warbond and
 * page). When the warbonds were scraped in this run the rows hold the table prices: (a) the value
 * that makes the page tables add up to "All Items Unlocked" wins, else (c) the item's own price
 * (two candidates never have a majority, so (b) never decides); every difference is a conflict,
 * and tables that still do not add up are a warning and a conflict. Otherwise the published rows
 * already hold resolved prices and the entities take them, so `--only <items>` keeps rule 1.
 */
export function linkWarbondCosts(
  dataset: Dataset,
  { scraped }: { scraped: boolean },
): WarbondCosts {
  if (!dataset.warbonds) {
    return { dataset, conflicts: [], warnings: [] };
  }
  const next = structuredClone(dataset) as { -readonly [C in keyof Dataset]: Dataset[C] };
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  const sourceOf = (ref: WarbondRef): { entity: Sourced; source: Source } | null => {
    if (ref.collection === "patterns") {
      const pattern = next.patterns?.find((candidate) => candidate.id === ref.id);
      const variant = pattern?.variants.find((candidate) => candidate.target === ref.variant);
      return pattern && variant
        ? { entity: { ...pattern, source: variant.source }, source: variant.source }
        : null;
    }
    const entity = (next[ref.collection] as readonly Sourced[] | undefined)?.find(
      (candidate) => candidate.id === ref.id,
    );
    return entity ? { entity, source: entity.source } : null;
  };

  for (const warbond of next.warbonds ?? []) {
    const rows = warbond.pages.flatMap((page) => page.items);
    const tableTotal = rows.reduce((sum, row) => sum + (medals(row.cost) ?? 0), 0);

    warbond.pages.forEach((page, p) => {
      page.items.forEach((row, i) => {
        const found = row.ref ? sourceOf(row.ref) : null;
        if (!row.ref || !found) {
          return;
        }
        const { entity, source } = found;
        if (source.warbondId !== warbond.id || source.page !== page.number) {
          return;
        }
        if (sameCost(row.cost, source.cost)) {
          return;
        }
        if (!scraped) {
          source.cost = row.cost;
          return;
        }
        const listed = medals(row.cost);
        const own = medals(source.cost);
        const tableWins =
          warbond.medalsAllItems !== null &&
          listed !== null &&
          own !== null &&
          tableTotal === warbond.medalsAllItems;
        const chosen = tableWins ? row.cost : source.cost;
        conflicts.push({
          collection: "warbonds",
          id: warbond.id,
          field: `pages[${p}].items[${i}].cost`,
          rule: 1,
          chosen,
          candidates: [
            {
              page: warbond.wiki.url,
              location: `Page ${page.number} › ${row.name}`,
              value: row.cost,
            },
            {
              page: entity.wiki.url,
              location: `${row.ref.collection}/${entity.id} › source`,
              value: source.cost,
            },
          ],
        });
        row.cost = chosen;
        source.cost = chosen;
      });
    });

    const resolvedTotal = rows.reduce((sum, row) => sum + (medals(row.cost) ?? 0), 0);
    if (scraped && warbond.medalsAllItems !== null && resolvedTotal !== warbond.medalsAllItems) {
      warnings.push(
        `warbonds/${warbond.id}: page tables add up to ${resolvedTotal} medals, All Items Unlocked says ${warbond.medalsAllItems}`,
      );
      conflicts.push({
        collection: "warbonds",
        id: warbond.id,
        field: "medalsAllItems",
        rule: 1,
        chosen: warbond.medalsAllItems,
        candidates: [
          {
            page: warbond.wiki.url,
            location: "infobox › All Items Unlocked",
            value: warbond.medalsAllItems,
          },
          { page: warbond.wiki.url, location: "page tables › sum", value: resolvedTotal },
        ],
      });
    }
  }

  return { dataset: next as Dataset, conflicts, warnings };
}
