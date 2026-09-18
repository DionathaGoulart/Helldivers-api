import type { Collection } from "@hd2/schemas";

/**
 * Dataset facts baked into `worker.js` at build (arch §8.4): code and data ship in one
 * deploy, so the Worker never reads `meta.json` to learn the version it serves.
 */
export interface BuildInfo {
  dataVersion: string;
  generatedAt: string;
  /** Ids of every collection a query filter references (`warbond`, `trait`, `passive`, `set`). */
  ids: Partial<Record<Collection, readonly string[]>>;
}
