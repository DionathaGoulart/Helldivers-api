import type { BuildInfo } from "./build-info.ts";
import type { B2ReadEnv, B2Reader } from "./lib/b2.ts";
import type { AssetFetcher, DataLoader } from "./lib/data-loader.ts";

/** Bindings of the Pages project: ASSETS always; the B2 values only matter to `/images/*`. */
export interface Env {
  ASSETS: AssetFetcher;
  B2_S3_ENDPOINT?: string; // wrangler.toml [vars]
  B2_BUCKET?: string; // wrangler.toml [vars]
  B2_READ_KEY_ID?: string; // Pages secret
  B2_READ_APP_KEY?: string; // Pages secret
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
  b2(env: B2ReadEnv): B2Reader;
  log(line: string): void;
}
