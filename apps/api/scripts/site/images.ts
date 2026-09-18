import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Entity images as static assets (arch §8.1, ADR-008): the scraper uploads them to the private B2
// bucket, `pnpm images:pull` keeps a local copy under `.cache/images`, and the build copies the
// live ones into `dist/images`. Keys are content hashed, so a cached file never goes stale.

/** `/images/v1/<collection>/<file>` → `<dir>/images/v1/<collection>/<file>`. */
export const imagePath = (dir: string, url: string) => join(dir, url.slice(1));

/** True when the bytes hash to the `<hash8>` of `….<hash8>.webp`. */
export function hashMatches(url: string, bytes: Uint8Array): boolean {
  const expected = /\.([a-f0-9]{8})\.webp$/.exec(url)?.[1];
  if (expected === undefined) return false;
  return createHash("sha256").update(bytes).digest("hex").startsWith(expected);
}

/** A cached image that is missing or whose bytes do not match its name reads as null. */
async function readVerified(path: string, url: string): Promise<Uint8Array | null> {
  try {
    const bytes = await readFile(path);
    return hashMatches(url, bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export interface ImageSource {
  /** `key` = the image url without its leading slash (`images/v1/…`). */
  get(key: string): Promise<Uint8Array>;
}

export interface PullResult {
  cached: number;
  downloaded: number;
  failed: string[]; // `<url>: <reason>`
}

/** Downloads every url missing from `cacheDir`, `concurrency` at a time. */
export async function pullImages(
  urls: readonly string[],
  cacheDir: string,
  source: ImageSource,
  concurrency = 8,
): Promise<PullResult> {
  const result: PullResult = { cached: 0, downloaded: 0, failed: [] };
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const path = imagePath(cacheDir, url);
      if (await readVerified(path, url)) {
        result.cached++;
        continue;
      }
      try {
        const bytes = await source.get(url.slice(1));
        if (!hashMatches(url, bytes)) throw new Error("bytes do not match the hash in the name");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        result.downloaded++;
      } catch (error) {
        result.failed.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  result.failed.sort();
  return result;
}

/** Copies every verified cached image into `distDir`; the rest are listed as missing. */
export async function copyImages(
  urls: readonly string[],
  cacheDir: string,
  distDir: string,
): Promise<{ copied: number; missing: string[] }> {
  let copied = 0;
  const missing: string[] = [];
  for (const url of urls) {
    const bytes = await readVerified(imagePath(cacheDir, url), url);
    if (!bytes) {
      missing.push(url);
      continue;
    }
    const target = imagePath(distDir, url);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    copied++;
  }
  return { copied, missing };
}
