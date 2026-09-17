import { Collection, jsonSchemaFiles } from "@hd2/schemas";
import type { BuildInfo } from "../../src/build-info.ts";
import { searchTerms } from "../../src/lib/text.ts";
import type { SearchIndex, SearchIndexRow } from "../../src/search-index.ts";
import { referencedCollections } from "../../src/spec/filters.ts";
import { renderCsv } from "./csv.ts";
import { listMeta, manifestWithUrls, readSiteData, type SiteData, writeJson } from "./dataset.ts";
import { FACETS, facetValues } from "./facets.ts";
import { renderHeaders, renderRedirects, renderRoutes } from "./headers.ts";
import { buildOpenApi, type OpenApiDocument } from "./openapi.ts";

// Everything the build adds to a copy of `data/v1` (arch §8.2), as dist-relative paths → text.
// Pure: `scripts/build.ts` reads the data, copies it, writes these files and bundles the worker.

export interface Site {
  data: SiteData;
  build: BuildInfo;
  openapi: OpenApiDocument;
  files: Map<string, string>;
}

export function searchIndex(data: SiteData): SearchIndex {
  const rows: SearchIndexRow[] = Collection.options.flatMap((collection) =>
    data.dataset[collection].map((entity): SearchIndexRow => {
      const aliases = "aliases" in entity ? entity.aliases : [];
      const image = "image" in entity ? (entity.image?.url ?? null) : null;
      return [collection, entity.id, entity.name, image, searchTerms(entity.name, aliases)];
    }),
  );
  return { meta: listMeta(data.manifest, rows.length), data: rows };
}

export function buildSite(dataFiles: ReadonlyMap<string, unknown>): Site {
  const data = readSiteData(dataFiles);
  const { manifest, dataset } = data;
  const files = new Map<string, string>();

  files.set("v1/meta.json", writeJson(manifestWithUrls(manifest)));

  for (const facet of FACETS) {
    const entities = dataset[facet.collection] as readonly never[];
    for (const value of facetValues(facet, dataset)) {
      const matching = entities.filter((entity) => facet.matches(entity, value));
      files.set(
        `v1/${facet.collection}/${facet.dir}/${value}.json`,
        writeJson({ meta: listMeta(manifest, matching.length), data: matching }),
      );
    }
  }

  for (const collection of Collection.options) {
    files.set(`v1/${collection}.csv`, renderCsv(collection, dataset[collection]));
  }

  // Read by the Functions only: compact, no indentation.
  files.set("v1/search-index.json", `${JSON.stringify(searchIndex(data))}\n`);

  for (const [name, text] of jsonSchemaFiles()) {
    files.set(`v1/schemas/${name}`, text);
  }

  const openapi = buildOpenApi(data);
  files.set("v1/openapi.json", writeJson(openapi));

  files.set("_headers", renderHeaders(manifest.dataVersion));
  files.set("_routes.json", renderRoutes());
  files.set("_redirects", renderRedirects());

  const build: BuildInfo = {
    dataVersion: manifest.dataVersion,
    generatedAt: manifest.generatedAt,
    ids: Object.fromEntries(
      referencedCollections().map((collection) => [
        collection,
        dataset[collection].map((entity) => entity.id),
      ]),
    ),
  };

  return { data, build, openapi, files };
}
