import { z } from "zod";
import { Collection, Id } from "./common.ts";

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

// `/v1/meta.json`. The API build adds per-collection URLs in Phase 5.
export const DatasetManifest = z.object({
  apiVersion: z.literal("v1"),
  dataVersion: DataVersion,
  generatedAt: z.iso.datetime(),
  source: DataSource,
  collections: z.partialRecord(Collection, z.object({ count: z.number().int().nonnegative() })),
});

export type DataVersion = z.infer<typeof DataVersion>;
export type Meta = z.infer<typeof Meta>;
export type Problem = z.infer<typeof Problem>;
export type Change = z.infer<typeof Change>;
export type ChangelogEntry = z.infer<typeof ChangelogEntry>;
export type DatasetManifest = z.infer<typeof DatasetManifest>;
