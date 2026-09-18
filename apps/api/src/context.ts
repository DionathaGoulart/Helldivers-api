import type { BuildInfo } from "./build-info.ts";
import type { RateLimiter } from "./lib/access.ts";
import type { CounterNamespace } from "./lib/counter.ts";
import type { AssetFetcher, DataLoader } from "./lib/data-loader.ts";

/** Bindings of the Worker (wrangler.toml); every one but ASSETS may be missing locally. */
export interface Env {
  ASSETS: AssetFetcher;
  RL_ANON?: RateLimiter;
  RL_ORIGIN?: RateLimiter;
  RL_KEY?: RateLimiter;
  LIMITER?: CounterNamespace; // Durable Object: exact per-client counts
  API_KEY_SECRET?: string; // Worker secret; `.dev.vars` locally
  REVOKED_KEYS?: string; // wrangler.toml [vars]: comma-separated key ids
  UNLIMITED_KEYS?: string; // wrangler.toml [vars]: comma-separated key ids
}

export type AppEnv = { Bindings: Env };

/** Cache API subset (`caches.default`). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface AppContext {
  build: BuildInfo;
  loader: DataLoader;
  cache(): CacheLike | null;
  log(line: string): void;
}
