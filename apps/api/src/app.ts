import { Collection } from "@hd2/schemas";
import { Hono } from "hono";
import type { BuildInfo } from "./build-info.ts";
import type { AppContext, AppEnv, CacheLike } from "./context.ts";
import { ALLOWED_METHODS, preflight } from "./lib/cors.ts";
import { DataLoader } from "./lib/data-loader.ts";
import { problemResponse } from "./lib/problem.ts";
import { registerQuery } from "./routes/query.ts";
import { registerSearch } from "./routes/search.ts";

// The Worker app (arch §8): only `/v1/query/*` and `/v1/search` reach it
// (`assets.run_worker_first`); every other URL, images included, is a static file.

export interface AppOptions {
  build: BuildInfo;
  /** `caches.default` on Cloudflare; null disables the Cache API. */
  cache?: () => CacheLike | null;
  log?: (line: string) => void;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const context: AppContext = {
    build: options.build,
    loader: new DataLoader(options.build.dataVersion),
    cache: options.cache ?? (() => null),
    log: options.log ?? ((line) => console.error(line)),
  };

  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      return problemResponse(
        c.req.url,
        {
          type: "method-not-allowed",
          detail: `${c.req.method} is not supported. Allowed: ${ALLOWED_METHODS}.`,
        },
        { Allow: ALLOWED_METHODS },
      );
    }
    await next();
    return;
  });
  app.use(preflight);
  registerQuery(app, context);
  registerSearch(app, context);

  app.notFound((c) =>
    problemResponse(c.req.url, {
      type: "not-found",
      detail: `No route for ${new URL(c.req.url).pathname}. Collections: ${Collection.options.join(", ")}.`,
    }),
  );
  // Never leak stack traces (arch §10).
  app.onError((error, c) => {
    context.log(
      JSON.stringify({ level: "error", msg: error.message, path: new URL(c.req.url).pathname }),
    );
    return problemResponse(c.req.url, {
      type: "internal-error",
      detail: "Unexpected error. Try again later.",
    });
  });
  return app;
}
