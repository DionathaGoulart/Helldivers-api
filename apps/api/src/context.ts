import type { BuildInfo } from "./build-info.ts";
import type { AssetFetcher, DataLoader } from "./lib/data-loader.ts";

/** Bindings of the Worker. */
export interface Env {
  ASSETS: AssetFetcher;
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
