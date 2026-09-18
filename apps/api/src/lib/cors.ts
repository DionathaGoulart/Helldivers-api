import type { MiddlewareHandler } from "hono";

// CORS `*` on every response (team rule, prd FR-33). Static files get the same headers from
// `_headers`; the Worker sets them here because `_headers` never applies to it (arch §8.4).

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "ETag, X-Data-Version, X-API-Tier, RateLimit-Policy, RateLimit, Retry-After",
} as const;

export const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

/** Answers preflights; `If-None-Match` is not a safelisted header, so revalidating clients send one. */
export const preflight: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "OPTIONS") {
    await next();
    return;
  }
  return c.body(null, 204, {
    ...CORS_HEADERS,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": c.req.header("Access-Control-Request-Headers") ?? "*",
    "Access-Control-Max-Age": "86400",
  });
};
