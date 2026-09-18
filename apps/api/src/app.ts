import { Collection } from "@hd2/schemas";
import { Hono } from "hono";
import type { BuildInfo } from "./build-info.ts";
import type { AppContext, AppEnv, CacheLike } from "./context.ts";
import { type B2ReadEnv, B2Reader } from "./lib/b2.ts";
import { ALLOWED_METHODS, preflight } from "./lib/cors.ts";
import { DataLoader } from "./lib/data-loader.ts";
import { problemResponse } from "./lib/problem.ts";
import { registerImages } from "./routes/images.ts";
import { registerQuery } from "./routes/query.ts";
import { registerSearch } from "./routes/search.ts";

// The Worker app (arch §8): only `/v1/query/*`, `/v1/search` and `/images/*` reach it
// (`assets.run_worker_first`); every other URL is a static file.

export interface AppOptions {
  build: BuildInfo;
  /** `caches.default` on Cloudflare; null disables the Cache API. */
  cache?: () => CacheLike | null;
  /** Outbound fetch to B2. */
  fetch?: (request: Request) => Promise<Response>;
  log?: (line: string) => void;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const readers = new Map<string, B2Reader>();
  const outbound = options.fetch ?? ((request: Request) => fetch(request));
  const context: AppContext = {
    build: options.build,
    loader: new DataLoader(options.build.dataVersion),
    cache: options.cache ?? (() => null),
    // One signer per key, so aws4fetch reuses its derived signing key across requests.
    b2(env: B2ReadEnv) {
      const id = `${env.B2_S3_ENDPOINT}\0${env.B2_BUCKET}\0${env.B2_READ_KEY_ID}`;
      let reader = readers.get(id);
      if (!reader) {
        reader = new B2Reader(env, outbound);
        readers.set(id, reader);
      }
      return reader;
    },
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
  registerImages(app, context);

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
