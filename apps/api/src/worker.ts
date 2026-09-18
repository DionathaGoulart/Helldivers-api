import { createApp } from "./app.ts";
import type { BuildInfo } from "./build-info.ts";
import type { CacheLike } from "./context.ts";

// Entry of `build/worker.js` (the Worker's `main`), bundled by `scripts/site/bundle.ts`.

/** Replaced by esbuild `define` with the dataset's BuildInfo. */
declare const __BUILD_INFO__: BuildInfo;
declare const caches: { readonly default: CacheLike };

const app = createApp({ build: __BUILD_INFO__, cache: () => caches.default });

export default { fetch: app.fetch };
