import { Collection } from "@hd2/schemas";

// Pages config files (arch §8.1, §8.2, §8.4). `_headers` never applies to Functions.

export const STATIC_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
export const FONT_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

/**
 * Rules matching one path are merged and a header set twice is joined with a comma, so CORS and
 * nosniff live only in `/*`.
 */
export function renderHeaders(dataVersion: string): string {
  return [
    "/*",
    "  Access-Control-Allow-Origin: *",
    "  X-Content-Type-Options: nosniff",
    "",
    "/v1/*",
    `  Cache-Control: ${STATIC_CACHE_CONTROL}`,
    "  Access-Control-Expose-Headers: ETag, X-Data-Version",
    `  X-Data-Version: ${dataVersion}`,
    "",
    // The font files change only with the package; a week of cache costs one revalidation.
    "/fonts/*",
    `  Cache-Control: ${FONT_CACHE_CONTROL}`,
    "",
  ].join("\n");
}

/** Only these reach `_worker.js`; every other request is a free static hit. */
export const ROUTES = {
  version: 1,
  include: ["/v1/query/*", "/v1/search", "/images/*"],
  exclude: [],
} as const;

export function renderRoutes(): string {
  return `${JSON.stringify(ROUTES, null, 2)}\n`;
}

/** `/v1/weapons` → `/v1/weapons.json`; extensionless item URLs are not aliased in v1. */
export function renderRedirects(): string {
  return Collection.options
    .map((collection) => `/v1/${collection} /v1/${collection}.json 301\n`)
    .join("");
}
