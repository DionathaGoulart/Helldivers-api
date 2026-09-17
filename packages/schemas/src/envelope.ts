import { z } from "zod";
import { Collection, Id, ImageUrl } from "./common.ts";

// Response envelope, errors and dataset-level files (arch §5.3, §6.6, §8.3).

export const DataVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}\.[a-f0-9]{8}$/); // date + dataset hash

export const DataSource = z.object({
  name: z.literal("The Helldivers Wiki"),
  url: z.literal("https://helldivers.wiki.gg"),
});

export const Meta = z.object({
  apiVersion: z.literal("v1"),
  dataVersion: DataVersion,
  generatedAt: z.iso.datetime(),
  count: z.number().int().nonnegative().optional(),
  source: DataSource,
});

export const List = <T extends z.ZodType>(item: T) => z.object({ meta: Meta, data: z.array(item) });
export const Item = <T extends z.ZodType>(item: T) => z.object({ meta: Meta, data: item });

// `/v1/query/<collection>` (arch §8.3): the list envelope plus paging, the parsed filters and links.
export const QueryMeta = Meta.extend({
  count: z.number().int().nonnegative(), // items in this page
  total: z.number().int().nonnegative(), // items matching the filters
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  filters: z.record(z.string(), z.union([z.array(z.string()), z.boolean(), z.string()])),
  sort: z.string(),
  fields: z.array(z.string()).nullable(), // null = every field
});

// Relative URLs (`/v1/query/weapons?page=2&limit=50`); null when there is no such page.
export const QueryLinks = z.object({
  self: z.string(),
  next: z.string().nullable(),
  prev: z.string().nullable(),
});

export const QueryList = <T extends z.ZodType>(item: T) =>
  z.object({ meta: QueryMeta, data: z.array(item), links: QueryLinks });

// `/v1/search` (prd FR-30).
export const SearchMeta = Meta.extend({
  count: z.number().int().nonnegative(), // results returned
  total: z.number().int().nonnegative(), // results before the limit
  q: z.string(),
  collections: z.array(Collection).nullable(), // null = every collection
  limit: z.number().int().positive(),
});

export const SearchResult = z.object({
  collection: Collection,
  id: Id,
  name: z.string(),
  image: ImageUrl.nullable(),
  url: z.string(), // `/v1/<collection>/<id>.json`
});

export const SearchResponse = z.object({ meta: SearchMeta, data: z.array(SearchResult) });

// RFC 9457 problem details.
export const Problem = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  instance: z.string(),
});

const ChangeRef = { collection: Collection, id: Id };

export const Change = z.discriminatedUnion("kind", [
  z.object({ ...ChangeRef, kind: z.enum(["added", "removed"]) }),
  z.object({ ...ChangeRef, kind: z.literal("changed"), paths: z.array(z.string().min(1)).min(1) }),
]);

export const ChangelogEntry = z
  .object({
    dataVersion: DataVersion,
    date: z.iso.date(),
    summary: z.object({
      added: z.number().int().nonnegative(),
      changed: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    }),
    changes: z.array(Change),
  })
  .refine(
    (entry) =>
      (["added", "changed", "removed"] as const).every(
        (kind) => entry.summary[kind] === entry.changes.filter((c) => c.kind === kind).length,
      ),
    "summary counts must match changes",
  );

// `/v1/meta.json`. The scraper writes counts; the API build adds the relative URLs.
export const CollectionManifest = z.object({
  count: z.number().int().nonnegative(),
  url: z.string().optional(), // `/v1/weapons.json`
  csv: z.string().optional(), // `/v1/weapons.csv`
  schema: z.string().optional(), // `/v1/schemas/weapon.json`
});

export const DatasetManifest = z.object({
  apiVersion: z.literal("v1"),
  dataVersion: DataVersion,
  generatedAt: z.iso.datetime(),
  source: DataSource,
  collections: z.partialRecord(Collection, CollectionManifest),
});

export type DataVersion = z.infer<typeof DataVersion>;
export type Meta = z.infer<typeof Meta>;
export type QueryMeta = z.infer<typeof QueryMeta>;
export type QueryLinks = z.infer<typeof QueryLinks>;
export type SearchMeta = z.infer<typeof SearchMeta>;
export type SearchResult = z.infer<typeof SearchResult>;
export type SearchResponse = z.infer<typeof SearchResponse>;
export type Problem = z.infer<typeof Problem>;
export type Change = z.infer<typeof Change>;
export type ChangelogEntry = z.infer<typeof ChangelogEntry>;
export type CollectionManifest = z.infer<typeof CollectionManifest>;
export type DatasetManifest = z.infer<typeof DatasetManifest>;
