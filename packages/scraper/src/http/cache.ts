import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// `.cache/http/<sha1(url)>.json` holds the validators, `<sha1(url)>.body` the bytes.
// Restored between Actions runs with actions/cache (ADR-009); never committed.

const CacheMeta = z.object({
  url: z.string(),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  fetchedAt: z.number().finite().optional(),
});

export interface Validators {
  etag: string | null;
  lastModified: string | null;
}

export interface CachedResponse extends Validators {
  body: Buffer;
  fetchedAt: number;
  legacyTimestamp: boolean;
}

const cacheKey = (url: string) => createHash("sha1").update(url).digest("hex");

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

export class HttpCache {
  constructor(readonly dir: string) {}

  /** Cached validators and body, or null on a miss (missing, corrupt or colliding entry). */
  async get(url: string): Promise<CachedResponse | null> {
    const key = cacheKey(url);
    try {
      const meta = CacheMeta.parse(
        JSON.parse(await readFile(join(this.dir, `${key}.json`), "utf8")),
      );
      if (meta.url !== url) {
        return null;
      }
      const body = await readFile(join(this.dir, `${key}.body`));
      const legacyTimestamp = meta.fetchedAt === undefined;
      const fetchedAt = meta.fetchedAt ?? (await stat(join(this.dir, `${key}.body`))).mtimeMs;
      return { etag: meta.etag, lastModified: meta.lastModified, body, fetchedAt, legacyTimestamp };
    } catch {
      return null;
    }
  }

  /** Body first, then validators: a crash in between only costs one full GET. */
  async put(
    url: string,
    validators: Validators,
    body: Uint8Array,
    fetchedAt = Date.now(),
  ): Promise<void> {
    const key = cacheKey(url);
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(join(this.dir, `${key}.body`), body);
    await writeAtomic(
      join(this.dir, `${key}.json`),
      JSON.stringify({ url, ...validators, fetchedAt }),
    );
  }
}
