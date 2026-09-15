import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  ChangelogEntry,
  Collection,
  type CollectionEntity,
  collectionSchemas,
  type Dataset,
  DatasetManifest,
  Item,
  List,
  Meta,
} from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";

// The `data/v1` tree as JSON values (arch §5.6): read the current one, render the next.

const SOURCE = { name: "The Helldivers Wiki", url: "https://helldivers.wiki.gg" } as const;

export interface CurrentDataset {
  manifest: DatasetManifest | null; // null before the first publish
  collections: Dataset;
  changelog: ChangelogEntry[];
  extraFiles: Map<string, unknown>; // schemas/* and reports/*, carried over verbatim
}

export class CurrentDatasetError extends Error {
  constructor(readonly details: readonly string[]) {
    super(`current dataset is unreadable: ${details.join("; ")}`);
    this.name = "CurrentDatasetError";
  }
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortById<T extends { id: string }>(list: readonly T[]): T[] {
  return [...list].sort(byId);
}

export function withCollection<C extends Collection>(
  dataset: Dataset,
  collection: C,
  entities: readonly CollectionEntity<C>[],
): Dataset {
  const copy: Record<string, unknown> = { ...dataset };
  copy[collection] = sortById(entities);
  return copy as Dataset;
}

export async function readCurrentDataset(v1Dir: string): Promise<CurrentDataset> {
  if (!existsSync(v1Dir)) {
    return { manifest: null, collections: {}, changelog: [], extraFiles: new Map() };
  }
  const { files, issues } = await readDatasetFiles(v1Dir);
  if (issues.length > 0) {
    throw new CurrentDatasetError(issues.map((issue) => `${issue.file}: ${issue.message}`));
  }
  try {
    const manifest = DatasetManifest.parse(files.get("meta.json"));
    let collections: Dataset = {};
    for (const collection of Collection.options) {
      const list = files.get(`${collection}.json`);
      if (list !== undefined) {
        const parsed = List(collectionSchemas[collection]).parse(list);
        collections = withCollection(collections, collection, parsed.data as never);
      }
    }
    const changelog = files.has("changelog.json")
      ? List(ChangelogEntry).parse(files.get("changelog.json")).data
      : [];
    const extraFiles = new Map(
      [...files].filter(([path]) => path.startsWith("schemas/") || path.startsWith("reports/")),
    );
    return { manifest, collections, changelog, extraFiles };
  } catch (error) {
    throw new CurrentDatasetError([error instanceof Error ? error.message : String(error)]);
  }
}

/** First 8 hex of sha256 over every present collection, in registry order. */
export function datasetHash(dataset: Dataset): string {
  const lists = Collection.options.flatMap((collection) => {
    const list = dataset[collection];
    return list ? [[collection, sortById<{ id: string }>(list)]] : [];
  });
  return createHash("sha256").update(JSON.stringify(lists)).digest("hex").slice(0, 8);
}

/** `2026-09-15T21:07:03.512Z` → `2026-09-15T21:07:03Z`. */
export const isoSeconds = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export interface RenderInput {
  dataVersion: string;
  generatedAt: string;
  collections: Dataset;
  changelog: readonly ChangelogEntry[];
  extraFiles: ReadonlyMap<string, unknown>;
}

/**
 * Relative path → JSON value. Every value goes through its zod schema, so keys come
 * out in schema order and `validateDataset` sees exactly what gets written.
 */
export function renderDataset(input: RenderInput): Map<string, unknown> {
  const { dataVersion, generatedAt } = input;
  const meta = (count?: number) =>
    Meta.parse({
      apiVersion: "v1",
      dataVersion,
      generatedAt,
      ...(count === undefined ? {} : { count }),
      source: SOURCE,
    });
  const present = Collection.options.filter((collection) => input.collections[collection]);

  const files = new Map<string, unknown>();
  files.set(
    "meta.json",
    DatasetManifest.parse({
      apiVersion: "v1",
      dataVersion,
      generatedAt,
      source: SOURCE,
      collections: Object.fromEntries(
        [...present]
          .sort()
          .map((collection) => [collection, { count: input.collections[collection]?.length ?? 0 }]),
      ),
    }),
  );
  files.set(
    "changelog.json",
    List(ChangelogEntry).parse({ meta: meta(input.changelog.length), data: input.changelog }),
  );
  for (const collection of present) {
    const schema = collectionSchemas[collection];
    const entities = sortById<{ id: string }>(input.collections[collection] ?? []);
    files.set(
      `${collection}.json`,
      List(schema).parse({ meta: meta(entities.length), data: entities }),
    );
    for (const entity of entities) {
      files.set(
        `${collection}/${entity.id}.json`,
        Item(schema).parse({ meta: meta(), data: entity }),
      );
    }
  }
  for (const [path, value] of input.extraFiles) {
    files.set(path, value);
  }
  return files;
}
