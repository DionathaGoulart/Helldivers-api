import type { Collection } from "@hd2/schemas";

/**
 * Dataset facts baked into `_worker.js` at build (arch §8.4): code and data ship in one
 * deploy, so the Functions never read `meta.json` to learn the version they serve.
 */
export interface BuildInfo {
  dataVersion: string;
  generatedAt: string;
  /** Ids of every collection a query filter references (`warbond`, `trait`, `passive`, `set`). */
  ids: Partial<Record<Collection, readonly string[]>>;
}
