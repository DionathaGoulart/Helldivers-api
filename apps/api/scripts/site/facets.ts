import {
  Armor,
  type Collection,
  type CollectionEntity,
  Department,
  Pattern,
  SourceType,
  Title,
  WarbondRefCollection,
  Weapon,
} from "@hd2/schemas";
import { sourcesOf } from "../../src/spec/filters.ts";
import type { SiteDataset } from "./dataset.ts";

// Static single-filter lists (arch §8.2, prd FR-17–FR-19):
// `/v1/<collection>/<dir>/<value>.json`, one file per value even when the list is empty, so every
// documented URL exists.

export interface Facet<C extends Collection = Collection> {
  collection: C;
  dir: string; // `by-warbond`
  param: string; // OpenAPI path parameter
  description: string;
  /** File names; `warbonds` = the warbond ids of the dataset (not listed in the OpenAPI enum). */
  values: readonly string[] | "warbonds";
  matches(entity: CollectionEntity<C>, value: string): boolean;
}

const kebab = (value: string) => value.replaceAll("_", "-");

function facet<C extends Collection>(facet: Facet<C>): Facet {
  return facet as unknown as Facet;
}

// Collections a warbond can sell carry a `source` (patterns: one per variant).
const acquirable = WarbondRefCollection.options.flatMap((collection) => [
  facet({
    collection,
    dir: "by-warbond",
    param: "warbondId",
    description: "Warbond id (`/v1/warbonds.json`); patterns match any variant.",
    values: "warbonds",
    matches: (entity, value) => sourcesOf(entity).some((source) => source.warbondId === value),
  }),
  facet({
    collection,
    dir: "by-source",
    param: "sourceType",
    description: "Source type; patterns match any variant.",
    values: SourceType.options,
    matches: (entity, value) => sourcesOf(entity).some((source) => source.type === value),
  }),
]);

export const FACETS: readonly Facet[] = [
  ...acquirable,
  facet({
    collection: "weapons",
    dir: "by-category",
    param: "category",
    description: "Weapon category.",
    values: Weapon.shape.category.options,
    matches: (weapon, value) => weapon.category === value,
  }),
  facet({
    collection: "stratagems",
    dir: "by-category",
    param: "department",
    description: "Ship department in kebab case (`orbital-cannons`).",
    values: Department.options.map(kebab),
    matches: (stratagem, value) =>
      stratagem.category !== null && kebab(stratagem.category) === value,
  }),
  facet({
    collection: "armors",
    dir: "by-weight",
    param: "weight",
    description: "Armor weight.",
    values: Armor.shape.weight.options,
    matches: (armor, value) => armor.weight === value,
  }),
  facet({
    collection: "patterns",
    dir: "by-scope",
    param: "scope",
    description: "Pattern scope.",
    values: Pattern.shape.scope.options,
    matches: (pattern, value) => pattern.scope === value,
  }),
  facet({
    collection: "titles",
    dir: "by-kind",
    param: "kind",
    description: "Title kind.",
    values: Title.shape.kind.options,
    matches: (title, value) => title.kind === value,
  }),
  facet({
    collection: "emotes",
    dir: "by-kind",
    param: "kind",
    description: "`emote` or `victory-pose`; an item can be both.",
    values: ["emote", "victory-pose"],
    matches: (emote, value) => (value === "emote" ? emote.emote : emote.victoryPose),
  }),
];

export function facetValues(facet: Facet, dataset: SiteDataset): readonly string[] {
  return facet.values === "warbonds" ? dataset.warbonds.map((warbond) => warbond.id) : facet.values;
}
