import type { Context } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { CORS_HEADERS } from "./cors.ts";
import { dynamicETag, matchesIfNoneMatch } from "./etag.ts";

export const DYNAMIC_CACHE_CONTROL = "public, max-age=300, s-maxage=86400";

/** Keeps the isolate alive for background work; outside Workers there is no ExecutionContext. */
export function waitUntil(c: Context<AppEnv>, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // app.request() in tests without a context: the promise still settles on its own.
  }
}

/**
 * Serves a validated query or search (arch §8.4). `canonical` is the path plus the normalized
 * query, so equivalent URLs share one ETag and one cache entry:
 * If-None-Match → 304 before any data is loaded; then the Cache API under a key that carries the
 * `dataVersion` (a deploy invalidates every entry); on a miss `render` builds the body.
 */
export async function serveDynamic(
  c: Context<AppEnv>,
  app: AppContext,
  canonical: string,
  render: () => Promise<unknown>,
): Promise<Response> {
  const { dataVersion } = app.build;
  const headers = {
    "Cache-Control": DYNAMIC_CACHE_CONTROL,
    ETag: dynamicETag(dataVersion, canonical),
    "X-Data-Version": dataVersion,
    "X-Content-Type-Options": "nosniff",
    ...CORS_HEADERS,
  };
  if (matchesIfNoneMatch(c.req.header("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }

  const cache = app.cache();
  const separator = canonical.includes("?") ? "&" : "?";
  const key = new Request(new URL(`${canonical}${separator}_dv=${dataVersion}`, c.req.url));
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) {
    return hit;
  }

  const body = JSON.stringify(await render());
  const response = new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
  if (cache) {
    waitUntil(
      c,
      cache.put(key, response.clone()).catch(() => undefined),
    );
  }
  return response;
}
