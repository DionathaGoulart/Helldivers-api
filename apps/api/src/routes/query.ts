import { Collection, type CollectionEntity, type QueryLinks, type QueryMeta } from "@hd2/schemas";
import type { Hono } from "hono";
import { z } from "zod";
import type { BuildInfo } from "../build-info.ts";
import type { AppContext, AppEnv } from "../context.ts";
import type { ListFile } from "../lib/data-loader.ts";
import { serveDynamic } from "../lib/dynamic.ts";
import { type ProblemInit, problemResponse } from "../lib/problem.ts";
import { matchScore, normalizeText, searchTerms, type TextQuery, textQuery } from "../lib/text.ts";
import {
  COMMON_PARAMETERS,
  DEFAULT_LIMIT,
  type Filters,
  fieldOptions,
  MAX_LIMIT,
  QUERY_FILTERS,
  sortOptions,
} from "../spec/filters.ts";

// `GET /v1/query/<collection>` (arch §8.2, prd FR-25, FR-28, FR-29).

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: ProblemInit };

export interface ParsedQuery {
  filters: [name: string, value: readonly string[] | boolean][]; // table order, values sorted
  q: string | null;
  text: TextQuery | null;
  sort: string;
  fields: readonly string[] | null; // schema order, always with `id`
  page: number;
  limit: number;
}

const fail = (type: ProblemInit["type"], detail: string): { ok: false; problem: ProblemInit } => ({
  ok: false,
  problem: { type, detail },
});

const PositiveInt = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));
const Limit = PositiveInt.pipe(z.number().max(MAX_LIMIT));
const BooleanValue = z.enum(["true", "false"]).transform((value) => value === "true");

/** Repeated parameters keep every value; a filter given twice is one OR list. */
export function groupParams(params: URLSearchParams): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [name, value] of params) {
    grouped.set(name, [...(grouped.get(name) ?? []), value]);
  }
  return grouped;
}

export function splitList(values: readonly string[]): string[] {
  return values.flatMap((value) => value.split(",")).map((value) => value.trim());
}

export function parseQuery(
  collection: Collection,
  params: URLSearchParams,
  ids: BuildInfo["ids"],
): ParseResult<ParsedQuery> {
  const filters = QUERY_FILTERS[collection] as Filters<Collection>;
  const allowed = [...Object.keys(filters), ...COMMON_PARAMETERS];
  const grouped = groupParams(params);
  for (const name of grouped.keys()) {
    if (!allowed.includes(name)) {
      return fail(
        "unknown-parameter",
        `Unknown parameter '${name}' for /v1/query/${collection}. Allowed: ${allowed.join(", ")}.`,
      );
    }
  }
  for (const name of COMMON_PARAMETERS) {
    if ((grouped.get(name)?.length ?? 0) > 1) {
      return fail("invalid-parameter", `'${name}' can be given only once.`);
    }
  }

  const parsed: ParsedQuery = {
    filters: [],
    q: null,
    text: null,
    sort: "id",
    fields: null,
    page: 1,
    limit: DEFAULT_LIMIT,
  };
  for (const [name, filter] of Object.entries(filters)) {
    const raw = grouped.get(name);
    if (!raw) continue;
    if (filter.kind === "boolean") {
      const value = raw.length === 1 ? BooleanValue.safeParse(raw[0]) : null;
      if (!value?.success) {
        return fail(
          "invalid-filter-value",
          `Invalid value '${raw.join(",")}' for '${name}'. Allowed: true, false.`,
        );
      }
      parsed.filters.push([name, value.data]);
      continue;
    }
    const values = splitList(raw);
    const known = new Set(filter.kind === "enum" ? filter.values : (ids[filter.collection] ?? []));
    for (const value of values) {
      if (value === "") {
        return fail("invalid-filter-value", `Empty value in '${name}'.`);
      }
      if (!known.has(value)) {
        const hint =
          filter.kind === "enum"
            ? [...known].join(", ")
            : `ids listed in /v1/${filter.collection}.json`;
        return fail(
          "invalid-filter-value",
          `Unknown value '${value}' for '${name}'. Allowed: ${hint}.`,
        );
      }
    }
    parsed.filters.push([name, [...new Set(values)].sort()]);
  }

  const q = grouped.get("q")?.[0]?.trim();
  if (q !== undefined) {
    const text = textQuery(q);
    if (!text) {
      return fail("invalid-parameter", "'q' needs at least 2 letters or digits.");
    }
    parsed.q = q;
    parsed.text = text;
  }

  const sort = grouped.get("sort")?.[0];
  if (sort !== undefined) {
    const options = sortOptions(collection);
    if (!options.includes(sort)) {
      return fail(
        "invalid-parameter",
        `Unknown value '${sort}' for 'sort'. Allowed: ${options.join(", ")}.`,
      );
    }
    parsed.sort = sort;
  }

  const fields = grouped.get("fields");
  if (fields) {
    const options = fieldOptions(collection);
    const wanted = new Set(["id"]);
    for (const field of splitList(fields)) {
      if (!options.includes(field)) {
        return fail(
          "invalid-parameter",
          `Unknown field '${field}' for 'fields'. Allowed: ${options.join(", ")}.`,
        );
      }
      wanted.add(field);
    }
    parsed.fields = options.filter((field) => wanted.has(field));
  }

  const page = grouped.get("page")?.[0];
  if (page !== undefined) {
    const value = PositiveInt.safeParse(page);
    if (!value.success) {
      return fail("invalid-parameter", "'page' must be an integer from 1.");
    }
    parsed.page = value.data;
  }
  const limit = grouped.get("limit")?.[0];
  if (limit !== undefined) {
    const value = Limit.safeParse(limit);
    if (!value.success) {
      return fail("invalid-parameter", `'limit' must be an integer from 1 to ${MAX_LIMIT}.`);
    }
    parsed.limit = value.data;
  }

  return { ok: true, value: parsed };
}

/** Normalized query string without `?`; defaults are left out (`page=1`, `limit=50`, `sort=id`). */
export function canonicalSearch(query: ParsedQuery, page = query.page): string {
  const parts = query.filters.map(([name, value]) =>
    typeof value === "boolean" ? `${name}=${value}` : `${name}=${value.join(",")}`,
  );
  if (query.q !== null) parts.push(`q=${encodeURIComponent(query.q)}`);
  if (query.sort !== "id") parts.push(`sort=${query.sort}`);
  if (query.fields) parts.push(`fields=${query.fields.join(",")}`);
  if (page !== 1) parts.push(`page=${page}`);
  if (query.limit !== DEFAULT_LIMIT) parts.push(`limit=${query.limit}`);
  return parts.join("&");
}

const withSearch = (path: string, search: string) => (search ? `${path}?${search}` : path);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Entity {
  id: string;
  name: string;
  aliases?: readonly string[];
  releaseDate?: string;
}

export interface QueryBody {
  meta: QueryMeta;
  data: unknown[];
  links: QueryLinks;
}

export function queryBody<C extends Collection>(
  collection: C,
  list: ListFile<CollectionEntity<C>>,
  query: ParsedQuery,
  build: BuildInfo,
): QueryBody {
  const filters = QUERY_FILTERS[collection] as Filters<Collection>;
  const matches = (entity: CollectionEntity<Collection>) =>
    query.filters.every(([name, value]) => {
      const filter = filters[name];
      if (!filter) return false;
      if (filter.kind === "boolean") return filter.select(entity) === value;
      const selected = filter.select(entity);
      return (value as readonly string[]).some((wanted) => selected.includes(wanted));
    }) &&
    (query.text === null ||
      matchScore(searchTerms(entity.name, (entity as Entity).aliases ?? []), query.text) !== null);

  const found = (list.data as CollectionEntity<Collection>[]).filter(matches) as Entity[];
  const descending = query.sort.startsWith("-");
  const key = descending ? query.sort.slice(1) : query.sort;
  if (key !== "id" || descending) {
    const sortKey = (entity: Entity) =>
      key === "name"
        ? normalizeText(entity.name)
        : key === "releaseDate"
          ? (entity.releaseDate ?? "")
          : entity.id;
    const keyed = found.map((entity) => ({ entity, key: sortKey(entity) }));
    keyed.sort((a, b) => {
      const order = descending ? compare(b.key, a.key) : compare(a.key, b.key);
      return order || compare(a.entity.id, b.entity.id);
    });
    found.splice(0, found.length, ...keyed.map(({ entity }) => entity));
  }

  const start = (query.page - 1) * query.limit;
  const fields = query.fields ? new Set(query.fields) : null;
  const data = found
    .slice(start, start + query.limit)
    .map((entity) =>
      fields
        ? Object.fromEntries(Object.entries(entity).filter(([name]) => fields.has(name)))
        : entity,
    );

  const path = `/v1/query/${collection}`;
  return {
    meta: {
      apiVersion: "v1",
      dataVersion: build.dataVersion,
      generatedAt: build.generatedAt,
      count: data.length,
      source: list.meta.source,
      total: found.length,
      page: query.page,
      limit: query.limit,
      filters: Object.fromEntries([
        ...query.filters.map(([name, value]) => [
          name,
          typeof value === "boolean" ? value : [...value],
        ]),
        ...(query.q === null ? [] : [["q", query.q]]),
      ]),
      sort: query.sort,
      fields: query.fields ? [...query.fields] : null,
    },
    data,
    links: {
      self: withSearch(path, canonicalSearch(query)),
      next:
        start + query.limit < found.length
          ? withSearch(path, canonicalSearch(query, query.page + 1))
          : null,
      prev: query.page > 1 ? withSearch(path, canonicalSearch(query, query.page - 1)) : null,
    },
  };
}

export function registerQuery(app: Hono<AppEnv>, context: AppContext): void {
  app.get("/v1/query/:collection", async (c) => {
    const collection = Collection.safeParse(c.req.param("collection"));
    if (!collection.success) {
      return problemResponse(c.req.url, {
        type: "not-found",
        detail: `Unknown collection '${c.req.param("collection")}'. Allowed: ${Collection.options.join(", ")}.`,
      });
    }
    const url = new URL(c.req.url);
    const parsed = parseQuery(collection.data, url.searchParams, context.build.ids);
    if (!parsed.ok) {
      return problemResponse(c.req.url, parsed.problem);
    }
    const path = `/v1/query/${collection.data}`;
    return serveDynamic(c, context, withSearch(path, canonicalSearch(parsed.value)), async () => {
      const list = await context.loader.collection(c.env.ASSETS, url.origin, collection.data);
      return queryBody(collection.data, list, parsed.value, context.build);
    });
  });
}
