import type { Collection, CollectionEntity, DatasetManifest } from "@hd2/schemas";
import { listMeta, type SiteDataset } from "./dataset.ts";

// Response examples for `/v1/openapi.json` (plan §8 Phase 6): every example is a real published
// entity, so the documented body cannot drift from the data. They live in `components.examples`
// and are referenced by the list, item, facet and query responses of the collection.

/** Preferred example per collection (the items audited in arch §5.4). */
export const EXAMPLE_IDS: Record<Collection, string> = {
  warbonds: "castellans-creed",
  weapons: "ar-23-liberator",
  stratagems: "orbital-precision-strike",
  armors: "tg-8-sharpshooter",
  helmets: "tg-8-sharpshooter",
  capes: "camo-cloak",
  "armor-sets": "tg-8-sharpshooter",
  boosters: "hellpod-space-optimization",
  passives: "true-grit",
  "weapon-traits": "light-armor-penetrating",
  "player-cards": "city-fighters-resolve",
  emotes: "clapping",
  patterns: "castellans-green",
  titles: "super-citizen",
};

/** The preferred item, or the first one when the dataset does not have it (synthetic data). */
export function exampleEntity<C extends Collection>(
  collection: C,
  dataset: SiteDataset,
): CollectionEntity<C> | undefined {
  const entities = dataset[collection];
  return entities.find((entity) => entity.id === EXAMPLE_IDS[collection]) ?? entities[0];
}

export interface Example {
  summary: string;
  value: unknown;
}

const example = (summary: string, value: unknown): Example => ({ summary, value });

/** `<Entity>Item`, `<Entity>List` and `<Entity>Query` examples of one collection. */
export function collectionExamples(
  collection: Collection,
  manifest: DatasetManifest,
  dataset: SiteDataset,
): { item?: Example; list?: Example; query?: Example } {
  const entity = exampleEntity(collection, dataset);
  if (!entity) return {};
  const name = entity.name;
  const total = dataset[collection].length;
  return {
    item: example(name, { meta: listMeta(manifest), data: entity }),
    list: example(`${name} (first of ${total})`, {
      meta: listMeta(manifest, total),
      data: [entity],
    }),
    query: example(`${name} (page 1 of ${total})`, {
      meta: {
        ...listMeta(manifest, 1),
        total,
        page: 1,
        limit: 1,
        filters: {},
        sort: "id",
        fields: null,
      },
      data: [entity],
      links: {
        self: `/v1/query/${collection}?limit=1`,
        next: total > 1 ? `/v1/query/${collection}?page=2&limit=1` : null,
        prev: null,
      },
    }),
  };
}

/** One search hit built from the weapons example, so the shape matches a real response. */
export function searchExample(
  manifest: DatasetManifest,
  dataset: SiteDataset,
): Example | undefined {
  const entity = exampleEntity("weapons", dataset);
  if (!entity) return undefined;
  const q = entity.name.split(" ")[0]?.toLowerCase() ?? entity.id;
  return example(`Search for "${q}"`, {
    meta: { ...listMeta(manifest, 1), total: 1, q, collections: ["weapons"], limit: 10 },
    data: [
      {
        collection: "weapons",
        id: entity.id,
        name: entity.name,
        image: entity.image?.url ?? null,
        url: `/v1/weapons/${entity.id}.json`,
      },
    ],
  });
}

/** Dataset manifest example: the document the build publishes at `/v1/meta.json`. */
export const metaExample = (manifest: DatasetManifest): Example =>
  example("Dataset manifest", manifest);

/** One problem body (arch §8.3); every error response points at it. */
export const problemExample = (errorsUrl: string): Example =>
  example("Invalid filter value", {
    type: `${errorsUrl}#invalid-filter-value`,
    title: "Invalid filter value",
    status: 400,
    detail: "category: `primray` is not a valid value. Allowed: primary, secondary, throwable.",
    instance: "/v1/query/weapons?category=primray",
  });
