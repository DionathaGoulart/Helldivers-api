import { Collection } from "@hd2/schemas";

// Static assets config files (arch §8.1, §8.2, §8.4). `_headers` never applies to Worker responses.

export const STATIC_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
export const FONT_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

/**
 * Rules matching one path are merged and a header set twice is joined with a comma, so CORS and
 * nosniff live only in `/*`.
 */
export function renderHeaders(dataVersion: string, buildId: string): string {
  return [
    "/*",
    "  Access-Control-Allow-Origin: *",
    "  X-Content-Type-Options: nosniff",
    // Names the deployment (the commit in CI): `X-Data-Version` only changes when the data does,
    // so a code- or docs-only deploy is invisible without this (smoke would test the old one).
    `  X-Build-Id: ${buildId}`,
    "",
    "/v1/*",
    `  Cache-Control: ${STATIC_CACHE_CONTROL}`,
    "  Access-Control-Expose-Headers: ETag, X-Data-Version, X-Build-Id",
    `  X-Data-Version: ${dataVersion}`,
    "",
    // The font files change only with the package; a week of cache costs one revalidation.
    "/fonts/*",
    `  Cache-Control: ${FONT_CACHE_CONTROL}`,
    "",
  ].join("\n");
}

/**
 * Only these run the Worker (`assets.run_worker_first` in wrangler.toml); every other request is a
 * free static hit.
 */
export const WORKER_ROUTES = ["/v1/query/*", "/v1/search", "/images/*"] as const;

/** `/v1/weapons` → `/v1/weapons.json`; extensionless item URLs are not aliased in v1. */
export function renderRedirects(): string {
  return Collection.options
    .map((collection) => `/v1/${collection} /v1/${collection}.json 301\n`)
    .join("");
}
