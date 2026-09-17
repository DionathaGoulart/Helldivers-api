import {
  Collection,
  type CollectionEntity,
  type DatasetManifest,
  entityNames,
  type Meta,
} from "@hd2/schemas";

// The published `data/v1` tree as the build reads it: every collection list plus meta.json.
// `scripts/build.ts` runs `validateDataset` first, so the files are trusted here.

export type SiteDataset = { readonly [C in Collection]: readonly CollectionEntity<C>[] };

export interface SiteData {
  manifest: DatasetManifest;
  dataset: SiteDataset;
}

export function readSiteData(files: ReadonlyMap<string, unknown>): SiteData {
  const manifest = files.get("meta.json") as DatasetManifest | undefined;
  if (!manifest) {
    throw new Error("meta.json is missing");
  }
  const dataset = Object.fromEntries(
    Collection.options.map((collection) => {
      const file = files.get(`${collection}.json`) as { data: unknown[] } | undefined;
      if (!file) {
        throw new Error(`${collection}.json is missing`);
      }
      return [collection, file.data];
    }),
  ) as unknown as SiteDataset;
  return { manifest, dataset };
}

/**
 * Envelope meta of a generated list (facets): same version and date as the dataset. Without a
 * count it is the meta of an item file, which has none.
 */
export function listMeta(manifest: DatasetManifest, count?: number): Meta {
  return {
    apiVersion: manifest.apiVersion,
    dataVersion: manifest.dataVersion,
    generatedAt: manifest.generatedAt,
    ...(count === undefined ? {} : { count }),
    source: manifest.source,
  };
}

/** `/v1/meta.json`: the scraper's manifest plus the URLs the build publishes per collection. */
export function manifestWithUrls(manifest: DatasetManifest): DatasetManifest {
  const collections = Object.fromEntries(
    Object.entries(manifest.collections).map(([collection, entry]) => [
      collection,
      {
        count: entry.count,
        url: `/v1/${collection}.json`,
        csv: `/v1/${collection}.csv`,
        schema: `/v1/schemas/${entityNames[collection as Collection]}.json`,
      },
    ]),
  );
  return { ...manifest, collections };
}

/** `data/v1` layout: pretty JSON with a trailing newline (scraper `writeJson`). */
export const writeJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
