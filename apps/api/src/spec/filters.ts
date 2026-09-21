import {
  Armor,
  type Collection,
  type CollectionEntity,
  collectionSchemas,
  Department,
  FiringMode,
  Pattern,
  PatternTarget,
  type Source,
  SourceType,
  Stratagem,
  Title,
  Warbond,
  Weapon,
} from "@hd2/schemas";

// Filters of `/v1/query/<collection>` (arch §8.2). The query route and the OpenAPI document are
// both generated from this table. Inside a filter, comma-separated values are OR; filters are AND.

type FilterValue = string | null;

export type Filter<E> =
  | {
      kind: "enum";
      description: string;
      values: readonly string[];
      select: (entity: E) => readonly FilterValue[];
    }
  | {
      kind: "id";
      description: string;
      collection: Collection; // valid values = ids of this collection
      select: (entity: E) => readonly FilterValue[];
    }
  | { kind: "boolean"; description: string; select: (entity: E) => boolean };

export type Filters<C extends Collection> = Readonly<Record<string, Filter<CollectionEntity<C>>>>;

type Sourced = { source: Source } | { variants: readonly { source: Source }[] };

/** Every source of an entity: one, or one per variant for patterns. */
export function sourcesOf(entity: Sourced): readonly Source[] {
  return "variants" in entity ? entity.variants.map((variant) => variant.source) : [entity.source];
}

function acquirable<E extends Sourced>(): Readonly<Record<string, Filter<E>>> {
  return {
    warbond: {
      kind: "id",
      collection: "warbonds",
      description: "Warbond id that sells the item (patterns: any variant).",
      select: (entity) => sourcesOf(entity).map((source) => source.warbondId),
    },
    source: {
      kind: "enum",
      values: SourceType.options,
      description: "How the item is obtained (patterns: any variant).",
      select: (entity) => sourcesOf(entity).map((source) => source.type),
    },
  };
}

/** Every collection: announced items that are not in the game yet. */
function upcoming<E extends { upcoming: boolean }>(): Readonly<Record<string, Filter<E>>> {
  return {
    upcoming: {
      kind: "boolean",
      description: "Announced, not in the game yet (the wiki lists it as unreleased).",
      select: (entity) => entity.upcoming,
    },
  };
}

const set = <E extends { setIds: readonly string[] }>(): Filter<E> => ({
  kind: "id",
  collection: "armor-sets",
  description: "Armor set id the item belongs to.",
  select: (entity) => entity.setIds,
});

export const QUERY_FILTERS: { readonly [C in Collection]: Filters<C> } = {
  warbonds: {
    type: {
      kind: "enum",
      values: Warbond.shape.type.options,
      description: "Warbond type.",
      select: (warbond) => [warbond.type],
    },
    ...upcoming(),
  },
  weapons: {
    category: {
      kind: "enum",
      values: Weapon.shape.category.options,
      description: "Weapon category.",
      select: (weapon) => [weapon.category],
    },
    subcategory: {
      kind: "enum",
      values: Weapon.shape.subcategory.options,
      description: "Weapon subcategory.",
      select: (weapon) => [weapon.subcategory],
    },
    ...acquirable(),
    trait: {
      kind: "id",
      collection: "weapon-traits",
      description: "Weapon trait id.",
      select: (weapon) => weapon.traitIds,
    },
    firingMode: {
      kind: "enum",
      values: FiringMode.options,
      description: "Firing mode of the firearm.",
      select: (weapon) => weapon.firearm?.firingModes ?? [],
    },
    ...upcoming(),
  },
  stratagems: {
    category: {
      kind: "enum",
      values: Department.options,
      description: "Ship department that sells the stratagem.",
      select: (stratagem) => [stratagem.category],
    },
    permit: {
      kind: "enum",
      values: Stratagem.shape.permitType.options,
      description: "Stratagem permit type.",
      select: (stratagem) => [stratagem.permitType],
    },
    kind: {
      kind: "enum",
      values: Stratagem.shape.kind.options,
      description: "Stratagem kind.",
      select: (stratagem) => [stratagem.kind],
    },
    availability: {
      kind: "enum",
      values: Stratagem.shape.availability.options,
      description: "Where the stratagem can be used.",
      select: (stratagem) => [stratagem.availability],
    },
    ...acquirable(),
    trait: {
      kind: "id",
      collection: "weapon-traits",
      description: "Weapon trait id.",
      select: (stratagem) => stratagem.traitIds,
    },
    ...upcoming(),
  },
  armors: {
    weight: {
      kind: "enum",
      values: Armor.shape.weight.options,
      description: "Armor weight.",
      select: (armor) => [armor.weight],
    },
    passive: {
      kind: "id",
      collection: "passives",
      description: "Armor passive id.",
      select: (armor) => [armor.passiveId],
    },
    ...acquirable(),
    set: set(),
    ...upcoming(),
  },
  helmets: { ...acquirable(), set: set(), ...upcoming() },
  capes: { ...acquirable(), set: set(), ...upcoming() },
  "armor-sets": {
    hasCape: {
      kind: "boolean",
      description: "Whether a cape was linked to the set.",
      select: (armorSet) => armorSet.capeId !== null,
    },
    ...upcoming(),
  },
  boosters: { ...acquirable(), ...upcoming() },
  passives: upcoming(),
  "weapon-traits": upcoming(),
  "player-cards": {
    ...acquirable(),
    hasCape: {
      kind: "boolean",
      description: "Whether the card is paired with a cape.",
      select: (card) => card.pairedCapeId !== null,
    },
    ...upcoming(),
  },
  emotes: {
    emote: {
      kind: "boolean",
      description: "Usable as an emote.",
      select: (emote) => emote.emote,
    },
    victoryPose: {
      kind: "boolean",
      description: "Usable as a victory pose.",
      select: (emote) => emote.victoryPose,
    },
    ...acquirable(),
    ...upcoming(),
  },
  patterns: {
    scope: {
      kind: "enum",
      values: Pattern.shape.scope.options,
      description: "Pattern scope.",
      select: (pattern) => [pattern.scope],
    },
    target: {
      kind: "enum",
      values: PatternTarget.options,
      description: "Target of any variant.",
      select: (pattern) => pattern.variants.map((variant) => variant.target),
    },
    ...acquirable(),
    ...upcoming(),
  },
  titles: {
    kind: {
      kind: "enum",
      values: Title.shape.kind.options,
      description: "Title kind.",
      select: (title) => [title.kind],
    },
    ...acquirable(),
    ...upcoming(),
  },
};

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const COMMON_PARAMETERS = ["q", "sort", "fields", "page", "limit"] as const;

/** `id` first (the default); warbonds also sort by release date. */
export function sortOptions(collection: Collection): readonly string[] {
  const keys = collection === "warbonds" ? ["id", "name", "releaseDate"] : ["id", "name"];
  return keys.flatMap((key) => [key, `-${key}`]);
}

/** Top-level keys `fields` accepts, in schema order. */
export function fieldOptions(collection: Collection): readonly string[] {
  return Object.keys(collectionSchemas[collection].shape);
}

/** Collections whose ids some filter accepts; the build bakes their ids into the Functions. */
export function referencedCollections(): Collection[] {
  const collections = new Set<Collection>();
  for (const filters of Object.values(QUERY_FILTERS) as Filters<Collection>[]) {
    for (const filter of Object.values(filters)) {
      if (filter.kind === "id") collections.add(filter.collection);
    }
  }
  return [...collections].sort();
}
