import type { SiteDataset } from "./dataset.ts";
import { expandStaticPaths, type OpenApiDocument } from "./openapi.ts";

// Build assertions (plan §7, arch §2 Pages limits): a dist that breaks one of them never deploys.

export const MAX_FILES = 20_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Pages upload rules: `_worker.js` and the config files are not assets. */
const NOT_ASSETS = new Set(["_worker.js", "_headers", "_redirects", "_routes.json"]);

export function checkDist(
  sizes: ReadonlyMap<string, number>, // dist-relative path → bytes
  openapi: OpenApiDocument,
  dataset: SiteDataset,
): string[] {
  const problems: string[] = [];
  const assets = [...sizes].filter(([path]) => !NOT_ASSETS.has(path));
  if (assets.length >= MAX_FILES) {
    problems.push(`${assets.length} files: Pages allows fewer than ${MAX_FILES}`);
  }
  for (const [path, bytes] of sizes) {
    if (bytes >= MAX_FILE_BYTES) problems.push(`${path}: ${bytes} bytes, Pages allows < 25 MiB`);
  }
  for (const url of expandStaticPaths(openapi, dataset)) {
    if (!sizes.has(url.slice(1))) problems.push(`${url}: documented in openapi.json but not built`);
  }
  return problems;
}
