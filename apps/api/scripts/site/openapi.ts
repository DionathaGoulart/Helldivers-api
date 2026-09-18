import {
  Attack,
  ChangelogEntry,
  Collection,
  ConflictReport,
  Cost,
  collectionSchemas,
  DatasetManifest,
  entityNames,
  FirearmStats,
  Id,
  Image,
  ImageManifest,
  Item,
  jsonSchemaFiles,
  List,
  Meta,
  Problem,
  QueryLinks,
  QueryList,
  QueryMeta,
  SearchResponse,
  SearchResult,
  Source,
  ThrowableStats,
  WarbondItem,
  WikiRef,
} from "@hd2/schemas";
import { z } from "zod";
import { ERRORS_URL, PROBLEM_TYPES, type ProblemType } from "../../src/lib/problem.ts";
import { MIN_QUERY_LENGTH } from "../../src/lib/text.ts";
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from "../../src/routes/search.ts";
import { SearchIndex } from "../../src/search-index.ts";
import {
  DEFAULT_LIMIT,
  type Filters,
  fieldOptions,
  MAX_LIMIT,
  QUERY_FILTERS,
  sortOptions,
} from "../../src/spec/filters.ts";
import { manifestWithUrls, type SiteData, type SiteDataset } from "./dataset.ts";
import {
  collectionExamples,
  type Example,
  metaExample,
  problemExample,
  searchExample,
} from "./examples.ts";
import { FACETS } from "./facets.ts";

// `/v1/openapi.json` (ADR-010): OpenAPI 3.1 generated from the zod schemas (`z.toJSONSchema`
// with a registry → `components.schemas`), the filter table and the facet table. The same tables
// drive the Worker and the static export, so the document cannot drift from what is served.

export const SITE_URL = "https://helldivers-api.pages.dev";
export const REPO_URL = "https://github.com/DionathaGoulart/Helldivers-api";

type JsonObject = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string } & JsonObject;
  servers: ({ url: string } & JsonObject)[];
  externalDocs: { description: string; url: string };
  tags: { name: string; description: string }[];
  paths: Record<string, { get: JsonObject }>;
  components: { schemas: Record<string, JsonObject>; examples: Record<string, Example> };
  "x-data-version": string;
}

const pascal = (name: string) =>
  name.replace(/(^|-)([a-z])/g, (_match, _dash: string, letter: string) => letter.toUpperCase());

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function jsonSchema(schema: z.ZodType): JsonObject {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { io: "input" }) as JsonObject;
  return rest;
}

const zodEnum = (values: readonly string[]) => z.enum(values as [string, ...string[]]);

/** Components: shared pieces first, then entity, list, item and query envelopes per collection. */
function components(): Record<string, JsonObject> {
  const registry = z.registry<{ id: string }>();
  const shared: [string, z.ZodType][] = [
    ["Meta", Meta],
    ["Problem", Problem],
    ["WikiRef", WikiRef],
    ["Image", Image],
    ["Cost", Cost],
    ["Source", Source],
    ["Attack", Attack],
    ["FirearmStats", FirearmStats],
    ["ThrowableStats", ThrowableStats],
    ["WarbondItem", WarbondItem],
    ["DatasetManifest", DatasetManifest],
    ["ChangelogEntry", ChangelogEntry],
    ["ChangelogList", List(ChangelogEntry)],
    ["ConflictReport", ConflictReport],
    ["ImageManifest", ImageManifest],
    ["QueryMeta", QueryMeta],
    ["QueryLinks", QueryLinks],
    ["SearchResult", SearchResult],
    ["SearchResponse", SearchResponse],
    ["SearchIndex", SearchIndex],
  ];
  for (const [id, schema] of shared) registry.add(schema, { id });
  for (const collection of Collection.options) {
    const name = pascal(entityNames[collection]);
    const schema = collectionSchemas[collection];
    registry.add(schema, { id: name });
    registry.add(List(schema), { id: `${name}List` });
    registry.add(Item(schema), { id: `${name}Item` });
    registry.add(QueryList(schema), { id: `${name}Query` });
  }
  const { schemas } = z.toJSONSchema(registry, {
    io: "input",
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, JsonObject> };
  // Each entity links its published JSON Schema file (plan §8): the same contract, standalone.
  const schemaFiles = new Map(
    Collection.options.map((collection) => [
      pascal(entityNames[collection]),
      `/v1/schemas/${entityNames[collection]}.json`,
    ]),
  );
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _schema, $id: _id, ...rest }]) => {
      const file = schemaFiles.get(id);
      return [
        id,
        file ? { ...rest, externalDocs: { description: "JSON Schema", url: file } } : rest,
      ];
    }),
  );
}

const exampleRef = (name: string) => ({ default: { $ref: `#/components/examples/${name}` } });

const json = (schema: JsonObject, example?: string | undefined) => ({
  "application/json": { schema, ...(example ? { examples: exampleRef(example) } : {}) },
});

const notModified = { description: "Not modified (`If-None-Match` matched the `ETag`)." };

function problems(...types: ProblemType[]): JsonObject {
  const byStatus = new Map<number, ProblemType[]>();
  for (const type of types) {
    const { status } = PROBLEM_TYPES[type];
    byStatus.set(status, [...(byStatus.get(status) ?? []), type]);
  }
  return Object.fromEntries(
    [...byStatus].map(([status, list]) => [
      String(status),
      {
        description: list.map((type) => `\`${type}\`: ${PROBLEM_TYPES[type].title}`).join("; "),
        content: {
          "application/problem+json": { schema: ref("Problem"), examples: exampleRef("Problem") },
        },
      },
    ]),
  );
}

const staticNotFound = {
  description: "No such file (HTML page from the static host).",
};

function staticJson(
  summary: string,
  tag: string,
  operationId: string,
  schema: JsonObject,
  example?: string | undefined,
) {
  return {
    get: {
      tags: [tag],
      summary,
      operationId,
      responses: {
        "200": { description: summary, content: json(schema, example) },
        "304": notModified,
        "404": staticNotFound,
      },
    },
  };
}

function pathParam(name: string, description: string, schema: z.ZodType): JsonObject {
  return { name, in: "path", required: true, description, schema: jsonSchema(schema) };
}

/** Comma-separated OR list: `?category=primary,secondary`. */
function listParam(name: string, description: string, schema: z.ZodType): JsonObject {
  return {
    name,
    in: "query",
    required: false,
    description: `${description} Comma-separated values match any.`,
    style: "form",
    explode: false,
    schema: jsonSchema(z.array(schema)),
  };
}

function queryParams(collection: Collection): JsonObject[] {
  const filters = QUERY_FILTERS[collection] as Filters<Collection>;
  const params = Object.entries(filters).map(([name, filter]) => {
    if (filter.kind === "boolean") {
      return {
        name,
        in: "query",
        required: false,
        description: filter.description,
        schema: { type: "boolean" },
      };
    }
    if (filter.kind === "enum") {
      return listParam(name, filter.description, zodEnum(filter.values));
    }
    return listParam(name, `${filter.description} Ids from \`/v1/${filter.collection}.json\`.`, Id);
  });
  return [
    ...params,
    {
      name: "q",
      in: "query",
      required: false,
      description: "Name or alias contains the text (case and diacritic insensitive).",
      schema: jsonSchema(z.string().min(MIN_QUERY_LENGTH)),
    },
    {
      name: "sort",
      in: "query",
      required: false,
      description: "Sort key; `-` for descending. Ties break by id.",
      schema: { ...jsonSchema(zodEnum(sortOptions(collection))), default: "id" },
    },
    listParam(
      "fields",
      "Top-level fields to return (`id` is always included).",
      zodEnum(fieldOptions(collection)),
    ),
    {
      name: "page",
      in: "query",
      required: false,
      schema: { ...jsonSchema(z.number().int().min(1)), default: 1 },
    },
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { ...jsonSchema(z.number().int().min(1).max(MAX_LIMIT)), default: DEFAULT_LIMIT },
    },
  ];
}

/** Real published bodies, keyed by the component they illustrate (`examples.ts`). */
function examples({ manifest, dataset }: SiteData): Record<string, Example> {
  const found: Record<string, Example> = {
    DatasetManifest: metaExample(manifestWithUrls(manifest)),
    Problem: problemExample(ERRORS_URL),
  };
  const search = searchExample(manifest, dataset);
  if (search) found.SearchResponse = search;
  for (const collection of Collection.options) {
    const entity = pascal(entityNames[collection]);
    const { item, list, query } = collectionExamples(collection, manifest, dataset);
    if (item) found[`${entity}Item`] = item;
    if (list) found[`${entity}List`] = list;
    if (query) found[`${entity}Query`] = query;
  }
  return found;
}

export function buildOpenApi(data: SiteData): OpenApiDocument {
  const { manifest } = data;
  const byComponent = examples(data);
  /** The example name when the dataset has one, so an empty collection documents no body. */
  const has = (name: string) => (byComponent[name] ? name : undefined);
  const paths: OpenApiDocument["paths"] = {
    "/v1/meta.json": staticJson(
      "Dataset manifest",
      "dataset",
      "getMeta",
      ref("DatasetManifest"),
      "DatasetManifest",
    ),
    "/v1/changelog.json": staticJson(
      "Last 90 data changes",
      "dataset",
      "getChangelog",
      ref("ChangelogList"),
    ),
    "/v1/openapi.json": staticJson("This document", "dataset", "getOpenApi", { type: "object" }),
    "/v1/schemas/{name}.json": {
      get: {
        tags: ["dataset"],
        summary: "JSON Schema of an entity or envelope",
        operationId: "getJsonSchema",
        parameters: [
          pathParam(
            "name",
            "Schema name.",
            zodEnum([...jsonSchemaFiles().keys()].map((file) => file.replace(/\.json$/, ""))),
          ),
        ],
        responses: {
          "200": { description: "JSON Schema (draft 2020-12)", content: json({ type: "object" }) },
          "304": notModified,
          "404": staticNotFound,
        },
      },
    },
    "/v1/reports/conflicts.json": staticJson(
      "Wiki contradictions and the value kept",
      "dataset",
      "getConflicts",
      ref("ConflictReport"),
    ),
    "/v1/reports/images.json": staticJson(
      "Image manifest",
      "dataset",
      "getImageManifest",
      ref("ImageManifest"),
    ),
    "/v1/search-index.json": staticJson(
      "Compact index read by /v1/search (format may change)",
      "search",
      "getSearchIndex",
      ref("SearchIndex"),
    ),
    "/v1/search": {
      get: {
        tags: ["search"],
        summary: "Search every collection by name and aliases",
        operationId: "search",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            description: "Text to find (case and diacritic insensitive).",
            schema: jsonSchema(z.string().min(MIN_QUERY_LENGTH)),
          },
          listParam("collections", "Collections to search.", Collection),
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              ...jsonSchema(z.number().int().min(1).max(SEARCH_MAX_LIMIT)),
              default: SEARCH_DEFAULT_LIMIT,
            },
          },
        ],
        responses: {
          "200": {
            description: "Best matches first",
            content: json(ref("SearchResponse"), has("SearchResponse")),
          },
          "304": notModified,
          ...problems("unknown-parameter", "invalid-parameter", "internal-error"),
        },
      },
    },
    "/images/v1/{collection}/{file}": {
      get: {
        tags: ["images"],
        summary: "Entity image (WebP, content-hashed, immutable)",
        description:
          "Use the `image.url` of an entity. The URL never changes content; cache it forever.",
        operationId: "getImage",
        parameters: [
          pathParam("collection", "Collection of the entity.", Collection),
          pathParam(
            "file",
            "`<id>[-<variant>].<hash8>.webp`.",
            z.string().regex(/^[a-z0-9-]+\.[a-f0-9]{8}\.webp$/),
          ),
        ],
        responses: {
          "200": {
            description: "WebP image",
            content: {
              "image/webp": { schema: { type: "string", contentMediaType: "image/webp" } },
            },
          },
          "304": notModified,
          ...problems("not-found", "image-backend-error", "images-unavailable"),
        },
      },
    },
  };

  for (const collection of Collection.options) {
    const entity = pascal(entityNames[collection]);
    const plural = pascal(collection);
    paths[`/v1/${collection}.json`] = staticJson(
      `Every ${entityNames[collection]}`,
      collection,
      `list${plural}`,
      ref(`${entity}List`),
      has(`${entity}List`),
    );
    const exampleItem = byComponent[`${entity}Item`]?.value as { data?: { id?: string } };
    paths[`/v1/${collection}/{id}.json`] = {
      get: {
        tags: [collection],
        summary: `One ${entityNames[collection]}`,
        operationId: `get${entity}`,
        parameters: [
          {
            ...pathParam("id", `Id from \`/v1/${collection}.json\`.`, Id),
            ...(exampleItem?.data?.id ? { example: exampleItem.data.id } : {}),
          },
        ],
        responses: {
          "200": {
            description: `One ${entityNames[collection]}`,
            content: json(ref(`${entity}Item`), has(`${entity}Item`)),
          },
          "304": notModified,
          "404": staticNotFound,
        },
      },
    };
    for (const facet of FACETS.filter((item) => item.collection === collection)) {
      const by = pascal(facet.dir.replace(/^by-/, ""));
      paths[`/v1/${collection}/${facet.dir}/{${facet.param}}.json`] = {
        get: {
          tags: [collection],
          summary: `${collection} ${facet.dir.replace("-", " ").replace("-", " ")}`,
          operationId: `list${plural}By${by}`,
          parameters: [
            pathParam(
              facet.param,
              facet.description,
              facet.values === "warbonds" ? Id : zodEnum(facet.values),
            ),
          ],
          responses: {
            "200": {
              description: "Matching items (possibly empty)",
              content: json(ref(`${entity}List`), has(`${entity}List`)),
            },
            "304": notModified,
            "404": staticNotFound,
          },
        },
      };
    }
    paths[`/v1/${collection}.csv`] = {
      get: {
        tags: [collection],
        summary: `Every ${entityNames[collection]} as CSV`,
        description:
          "Nested fields are dotted columns, lists are `;`-joined, object lists are JSON.",
        operationId: `list${plural}Csv`,
        responses: {
          "200": {
            description: "RFC 4180 CSV",
            content: { "text/csv": { schema: { type: "string" } } },
          },
          "304": notModified,
        },
      },
    };
    paths[`/v1/query/${collection}`] = {
      get: {
        tags: [collection],
        summary: `Filter, sort and page ${collection}`,
        description: "Filters combine with AND. Prefer the static lists and facets when they fit.",
        operationId: `query${plural}`,
        parameters: queryParams(collection),
        responses: {
          "200": {
            description: "One page of matches",
            content: json(ref(`${entity}Query`), has(`${entity}Query`)),
          },
          "304": notModified,
          ...problems(
            "unknown-parameter",
            "invalid-filter-value",
            "invalid-parameter",
            "internal-error",
          ),
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Helldivers 2 Data API",
      version: "v1",
      summary: "The Helldivers 2 catalog as JSON: weapons, stratagems, armor, warbonds and more.",
      description: [
        "Free, public, read-only JSON API with the Helldivers 2 catalog, built from The Helldivers Wiki.",
        "",
        "- No key, no rate limit, CORS open to every origin.",
        "- Every list and item is a static file: prefer them and the `by-*` facets over `/v1/query/*`.",
        "- Responses carry an `ETag`; send `If-None-Match` and take the `304`.",
        "- `image.url` is content-hashed and immutable — cache it forever.",
        "- Enums are open: ignore values you do not know.",
        "",
        `Every entity also has a standalone JSON Schema under \`/v1/schemas/\`, and the dataset it was`,
        "built from is named by `x-data-version`.",
      ].join("\n"),
      license: { name: "CC BY-NC-SA 4.0", identifier: "CC-BY-NC-SA-4.0" },
      contact: { name: "Source on GitHub", url: REPO_URL },
    },
    servers: [{ url: SITE_URL }],
    externalDocs: { description: "Docs and quickstart", url: `${SITE_URL}/` },
    tags: [
      { name: "dataset", description: "Manifest, changelog, schemas and reports." },
      { name: "search", description: "Cross-collection name search." },
      { name: "images", description: "Entity images proxied from private storage." },
      ...Collection.options.map((collection) => ({
        name: collection,
        description: `List, item, facet, CSV and query routes of ${collection}.`,
      })),
    ],
    paths,
    components: { schemas: components(), examples: byComponent },
    "x-data-version": manifest.dataVersion,
  };
}

/** Dynamic routes are served by the Worker; every other documented path is a static file. */
export const isDynamicPath = (path: string) =>
  path === "/v1/search" || path.startsWith("/v1/query/") || path.startsWith("/images/");

/**
 * Concrete URLs of every static path in the document: enum parameters expand to their values,
 * `{id}` to the collection's ids, `{warbondId}` to the warbond ids.
 */
export function expandStaticPaths(document: OpenApiDocument, dataset: SiteDataset): string[] {
  const urls: string[] = [];
  for (const [template, { get }] of Object.entries(document.paths)) {
    if (isDynamicPath(template)) continue;
    let expanded = [template];
    for (const parameter of (get.parameters ?? []) as JsonObject[]) {
      if (parameter.in !== "path") continue;
      const name = String(parameter.name);
      const schema = parameter.schema as { enum?: string[] };
      let values: readonly string[];
      if (schema.enum) {
        values = schema.enum;
      } else if (name === "id") {
        const collection = Collection.parse(template.split("/")[2]);
        values = dataset[collection].map((entity) => entity.id);
      } else if (name === "warbondId") {
        values = dataset.warbonds.map((warbond) => warbond.id);
      } else {
        throw new Error(`${template}: cannot expand {${name}}`);
      }
      expanded = expanded.flatMap((url) => values.map((value) => url.replace(`{${name}}`, value)));
    }
    urls.push(...expanded);
  }
  return urls;
}
