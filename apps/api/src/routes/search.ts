import { Collection, type SearchResponse } from "@hd2/schemas";
import type { Hono } from "hono";
import { z } from "zod";
import type { BuildInfo } from "../build-info.ts";
import type { AppContext, AppEnv } from "../context.ts";
import { serveDynamic } from "../lib/dynamic.ts";
import { problemResponse } from "../lib/problem.ts";
import { matchScore, type TextQuery, textQuery } from "../lib/text.ts";
import type { SearchIndex } from "../search-index.ts";
import { groupParams, type ParseResult, splitList } from "./query.ts";

// `GET /v1/search?q=&collections=&limit=` (arch §8.2, prd FR-26, FR-30).

export const SEARCH_PARAMETERS = ["q", "collections", "limit"] as const;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

export interface ParsedSearch {
  q: string;
  text: TextQuery;
  collections: readonly Collection[] | null; // arch order
  limit: number;
}

const Limit = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(SEARCH_MAX_LIMIT));

export function parseSearch(params: URLSearchParams): ParseResult<ParsedSearch> {
  const grouped = groupParams(params);
  for (const [name, values] of grouped) {
    if (!(SEARCH_PARAMETERS as readonly string[]).includes(name)) {
      return {
        ok: false,
        problem: {
          type: "unknown-parameter",
          detail: `Unknown parameter '${name}' for /v1/search. Allowed: ${SEARCH_PARAMETERS.join(", ")}.`,
        },
      };
    }
    if (values.length > 1) {
      return {
        ok: false,
        problem: { type: "invalid-parameter", detail: `'${name}' can be given only once.` },
      };
    }
  }

  const q = grouped.get("q")?.[0]?.trim();
  const text = q === undefined ? null : textQuery(q);
  if (q === undefined || !text) {
    return {
      ok: false,
      problem: {
        type: "invalid-parameter",
        detail: "'q' is required and needs at least 2 letters or digits.",
      },
    };
  }

  let collections: Collection[] | null = null;
  const rawCollections = grouped.get("collections");
  if (rawCollections) {
    const wanted = new Set<string>();
    for (const value of splitList(rawCollections)) {
      if (!Collection.safeParse(value).success) {
        return {
          ok: false,
          problem: {
            type: "invalid-parameter",
            detail: `Unknown value '${value}' for 'collections'. Allowed: ${Collection.options.join(", ")}.`,
          },
        };
      }
      wanted.add(value);
    }
    collections = Collection.options.filter((collection) => wanted.has(collection));
  }

  let limit = SEARCH_DEFAULT_LIMIT;
  const rawLimit = grouped.get("limit")?.[0];
  if (rawLimit !== undefined) {
    const value = Limit.safeParse(rawLimit);
    if (!value.success) {
      return {
        ok: false,
        problem: {
          type: "invalid-parameter",
          detail: `'limit' must be an integer from 1 to ${SEARCH_MAX_LIMIT}.`,
        },
      };
    }
    limit = value.data;
  }

  return { ok: true, value: { q, text, collections, limit } };
}

export function canonicalSearchQuery(search: ParsedSearch): string {
  const parts = [`q=${encodeURIComponent(search.q)}`];
  if (search.collections) parts.push(`collections=${search.collections.join(",")}`);
  if (search.limit !== SEARCH_DEFAULT_LIMIT) parts.push(`limit=${search.limit}`);
  return parts.join("&");
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Best score first, then name, collection (arch order) and id. */
export function searchBody(
  index: SearchIndex,
  search: ParsedSearch,
  build: BuildInfo,
): SearchResponse {
  const allowed = search.collections ? new Set<string>(search.collections) : null;
  const order = new Map(Collection.options.map((collection, i) => [collection, i]));
  const hits: { row: SearchIndex["data"][number]; score: number }[] = [];
  for (const row of index.data) {
    if (allowed && !allowed.has(row[0])) continue;
    const score = matchScore(row[4], search.text);
    if (score !== null) hits.push({ row, score });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      compare(a.row[4][0] ?? "", b.row[4][0] ?? "") ||
      (order.get(a.row[0]) ?? 0) - (order.get(b.row[0]) ?? 0) ||
      compare(a.row[1], b.row[1]),
  );
  const data = hits.slice(0, search.limit).map(({ row: [collection, id, name, image] }) => ({
    collection,
    id,
    name,
    image,
    url: `/v1/${collection}/${id}.json`,
  }));
  return {
    meta: {
      apiVersion: "v1",
      dataVersion: build.dataVersion,
      generatedAt: build.generatedAt,
      count: data.length,
      source: index.meta.source,
      total: hits.length,
      q: search.q,
      collections: search.collections ? [...search.collections] : null,
      limit: search.limit,
    },
    data,
  };
}

export function registerSearch(app: Hono<AppEnv>, context: AppContext): void {
  app.get("/v1/search", async (c) => {
    const url = new URL(c.req.url);
    const parsed = parseSearch(url.searchParams);
    if (!parsed.ok) {
      return problemResponse(c.req.url, parsed.problem);
    }
    const canonical = `/v1/search?${canonicalSearchQuery(parsed.value)}`;
    return serveDynamic(c, context, canonical, async () => {
      const index = await context.loader.searchIndex(c.env.ASSETS, url.origin);
      return searchBody(index, parsed.value, context.build);
    });
  });
}
