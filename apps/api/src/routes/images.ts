import { Collection, ImageUrl } from "@hd2/schemas";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "../context.ts";
import { B2ReadEnv } from "../lib/b2.ts";
import { CORS_HEADERS } from "../lib/cors.ts";
import { waitUntil } from "../lib/dynamic.ts";
import { matchesIfNoneMatch } from "../lib/etag.ts";
import { problemResponse } from "../lib/problem.ts";

// `GET /images/v1/<collection>/<id>.<hash8>.webp` (arch §8.1, ADR-006): proxy to the private B2
// bucket. The key is content hashed, so a response never changes: `immutable`, strong ETag = hash.

export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function registerImages(app: Hono<AppEnv>, context: AppContext): void {
  app.get("/images/*", async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const notFound = () =>
      problemResponse(c.req.url, { type: "not-found", detail: `No image at ${path}.` });
    // Anything that is not an image key is refused without contacting B2.
    const hash = /\.([a-f0-9]{8})\.webp$/.exec(path)?.[1];
    if (
      !hash ||
      !ImageUrl.safeParse(path).success ||
      !Collection.safeParse(path.split("/")[3]).success
    ) {
      return notFound();
    }

    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": IMAGE_CACHE_CONTROL,
      ETag: `"${hash}"`,
      "X-Content-Type-Options": "nosniff",
      ...CORS_HEADERS,
    };
    if (matchesIfNoneMatch(c.req.header("If-None-Match"), headers.ETag)) {
      return new Response(null, { status: 304, headers });
    }

    const cache = context.cache();
    const key = new Request(new URL(path, url.origin));
    const hit = await cache?.match(key).catch(() => undefined);
    if (hit) {
      return hit;
    }

    const env = B2ReadEnv.safeParse(c.env);
    if (!env.success) {
      return problemResponse(c.req.url, {
        type: "images-unavailable",
        detail: "The image backend is not configured on this deployment.",
      });
    }
    let upstream: Response;
    try {
      upstream = await context.b2(env.data).get(path.slice(1));
    } catch (error) {
      context.log(
        JSON.stringify({ level: "error", msg: "b2 fetch failed", path, error: String(error) }),
      );
      return problemResponse(c.req.url, {
        type: "image-backend-error",
        detail: "Could not reach the image backend.",
      });
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      if (upstream.status === 404) {
        return notFound();
      }
      context.log(
        JSON.stringify({
          level: "error",
          msg: "b2 answered an error",
          path,
          status: upstream.status,
        }),
      );
      return problemResponse(c.req.url, {
        type: "image-backend-error",
        detail: `The image backend answered HTTP ${upstream.status}.`,
      });
    }

    const length = upstream.headers.get("Content-Length");
    const response = new Response(upstream.body, {
      status: 200,
      headers: length ? { ...headers, "Content-Length": length } : headers,
    });
    if (cache) {
      waitUntil(
        c,
        cache.put(key, response.clone()).catch(() => undefined),
      );
    }
    return response;
  });
}
