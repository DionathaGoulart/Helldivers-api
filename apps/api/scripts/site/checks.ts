import type { SiteDataset } from "./dataset.ts";
import { expandStaticPaths, type OpenApiDocument } from "./openapi.ts";

// Build assertions (plan §7, arch §2 static assets limits): a dist that breaks one of them never
// deploys.

export const MAX_FILES = 20_000;

/** The docs site (arch §9): copied from `apps/docs`, easy to lose to a wrong copy filter. */
export const REQUIRED_PAGES = [
  "index.html",
  "404.html",
  "theme.css",
  "app.js",
  "docs/index.html",
  "docs/errors.html",
  "docs/access.html",
  "docs/reference.js",
  "examples.html",
  "examples.js",
];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Workers static assets upload rules: the config files are parsed, not uploaded. */
const NOT_ASSETS = new Set(["_headers", "_redirects"]);

export function checkDist(
  sizes: ReadonlyMap<string, number>, // dist-relative path → bytes
  openapi: OpenApiDocument,
  dataset: SiteDataset,
): string[] {
  const problems: string[] = [];
  const assets = [...sizes].filter(([path]) => !NOT_ASSETS.has(path));
  if (assets.length >= MAX_FILES) {
    problems.push(`${assets.length} files: static assets allow fewer than ${MAX_FILES}`);
  }
  for (const [path, bytes] of sizes) {
    if (bytes >= MAX_FILE_BYTES)
      problems.push(`${path}: ${bytes} bytes, static assets allow < 25 MiB`);
  }
  for (const page of REQUIRED_PAGES) {
    if (!sizes.has(page)) problems.push(`${page}: docs page missing from dist`);
  }
  if (![...sizes.keys()].some((path) => path.startsWith("fonts/"))) {
    problems.push("fonts/: the self-hosted font was not copied");
  }
  for (const url of expandStaticPaths(openapi, dataset)) {
    if (!sizes.has(url.slice(1))) problems.push(`${url}: documented in openapi.json but not built`);
  }
  return problems;
}
