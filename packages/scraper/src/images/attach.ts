import { createHash } from "node:crypto";
import type {
  Collection,
  Dataset,
  Id,
  Image,
  ImageManifest,
  ImageManifestEntry,
  PatternTarget,
} from "@hd2/schemas";
import { BlockedError } from "../http/block-detect.ts";
import { DisallowedUrlError } from "../http/client.ts";
import type { Logger } from "../log.ts";
import type { RawImage } from "../parsers/raw.ts";
import type { ImageStore } from "./b2.ts";
import { downloadPath, type ImageFetcher, imageVersion, isVector } from "./download.ts";
import type { EncodedImage, ImageEncoder } from "./encode.ts";
import { nextManifest, withoutOrphans } from "./manifest.ts";
import { COLLECTION_RENDITION } from "./rendition.ts";

// Step 7 (arch §6.1, §6.5): wiki pictures → WebP → private B2 bucket → `Image` objects and the
// upload manifest. A picture whose wiki file, version and rendition are already in the manifest
// is neither downloaded nor uploaded. Offline runs (no backend) only reuse the manifest.

export const IMAGE_BUDGET_BYTES = 150 * 1024;
export const MAX_FAILURE_RATIO = 0.05;

/** A picture a pipeline found for one entity, or one pattern variant. */
export interface ImageRequest {
  id: Id;
  variant: PatternTarget | null;
  image: RawImage;
}

export interface ImageBackend {
  fetcher: ImageFetcher;
  encoder: ImageEncoder;
  store: ImageStore;
}

export interface ImageStats {
  requested: number;
  reused: number; // already in the manifest
  fetched: number; // wiki downloads
  uploaded: number;
  failed: number;
  deleted: number; // orphans removed from B2
  images: number; // live manifest entries
  orphans: number;
  bytes: number; // size of the live images
}

export class ImageFailureError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`${failures.length} images failed`);
    this.name = "ImageFailureError";
  }
}

export interface AttachImagesInput {
  dataset: Dataset; // merged and linked, scraped entities with `image: null`
  published: Dataset; // the current data/v1, for fallbacks
  requests: ReadonlyMap<Collection, readonly ImageRequest[]>; // scraped collections only
  previous: ImageManifest | null;
  backend: ImageBackend | null;
  date: string; // UTC date of the run
  logger: Logger;
}

export interface AttachImagesResult {
  dataset: Dataset;
  manifest: ImageManifest | null; // null when no image is live nor orphaned
  warnings: string[];
  stats: ImageStats;
}

type Entity = { id: Id; image: Image | null; variants?: { target: string; image: Image | null }[] };

const keyBase = (collection: Collection, id: Id, variant: PatternTarget | null) =>
  `/images/v1/${collection}/${id}${variant ? `-${variant}` : ""}`;
const baseOf = (url: string) => url.replace(/\.[a-f0-9]{8}\.webp$/, "");
const imageOf = (entry: ImageManifestEntry): Image => ({
  url: entry.url,
  width: entry.width,
  height: entry.height,
  wikiFile: entry.wikiFile,
});
const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function publishedImage(
  published: Dataset,
  collection: Collection,
  id: Id,
  variant: PatternTarget | null,
): Image | null {
  const entity = (published[collection] as readonly Entity[] | undefined)?.find((e) => e.id === id);
  if (!entity) {
    return null;
  }
  return variant
    ? (entity.variants?.find((candidate) => candidate.target === variant)?.image ?? null)
    : entity.image;
}

/** Every image a dataset references, pattern variants included. */
function referencedImages(dataset: Dataset): Image[] {
  return Object.values(dataset).flatMap((list) =>
    (list as readonly Entity[]).flatMap((entity) => [
      ...(entity.image ? [entity.image] : []),
      ...(entity.variants ?? []).flatMap((variant) => (variant.image ? [variant.image] : [])),
    ]),
  );
}

export async function attachImages(input: AttachImagesInput): Promise<AttachImagesResult> {
  const { backend, previous, date, logger } = input;
  const warnings: string[] = [];
  const failures: string[] = [];
  const stats: ImageStats = {
    requested: 0,
    reused: 0,
    fetched: 0,
    uploaded: 0,
    failed: 0,
    deleted: 0,
    images: 0,
    orphans: 0,
    bytes: 0,
  };

  const entries = new Map<string, ImageManifestEntry>(
    (previous?.images ?? []).map((entry) => [entry.url, entry]),
  );
  const byBase = new Map<string, ImageManifestEntry[]>();
  for (const entry of entries.values()) {
    byBase.set(baseOf(entry.url), [...(byBase.get(baseOf(entry.url)) ?? []), entry]);
  }
  const downloads = new Map<string, Promise<Buffer>>();
  const encodings = new Map<string, Promise<EncodedImage>>();
  const stored = new Set<string>();
  let offlineMisses = 0;

  const download = (path: string) => {
    let body = downloads.get(path);
    if (!body) {
      stats.fetched += 1;
      body = (backend as ImageBackend).fetcher.fetch(path);
      downloads.set(path, body);
    }
    return body;
  };
  const encode = (source: Buffer, rendition: ImageManifestEntry["rendition"], vector: boolean) => {
    const key = `${createHash("sha256").update(source).digest("hex")}:${rendition}:${vector}`;
    let encoded = encodings.get(key);
    if (!encoded) {
      encoded = (backend as ImageBackend).encoder.encode(source, rendition, vector);
      encodings.set(key, encoded);
    }
    return encoded;
  };

  // Resolve every request to an image: reuse, fresh upload, or the published fallback.
  const resolved = new Map<string, Image | null>();
  for (const [collection, requests] of input.requests) {
    const rendition = COLLECTION_RENDITION[collection];
    if (!rendition) {
      throw new Error(`${collection} has no image rendition`);
    }
    for (const { id, variant, image } of requests) {
      stats.requested += 1;
      const base = keyBase(collection, id, variant);
      const version = imageVersion(image.src);
      const reuse = byBase
        .get(base)
        ?.find(
          (entry) =>
            entry.wikiFile === image.file &&
            entry.version === version &&
            entry.rendition === rendition,
        );
      if (reuse) {
        stats.reused += 1;
        resolved.set(base, imageOf(reuse));
        continue;
      }
      const fallback = () => publishedImage(input.published, collection, id, variant);
      if (!backend) {
        offlineMisses += 1;
        resolved.set(base, fallback());
        continue;
      }
      try {
        const vector = isVector(image.file);
        const source = await download(downloadPath(image, rendition));
        const encoded = await encode(source, rendition, vector);
        const hash = createHash("sha256").update(encoded.body).digest("hex").slice(0, 8);
        const url = `${base}.${hash}.webp`;
        if (!entries.has(url) && !stored.has(url)) {
          const key = url.slice(1);
          if (!(await backend.store.exists(key))) {
            await backend.store.put(key, encoded.body);
            stats.uploaded += 1;
            logger.info("image uploaded", { key, bytes: encoded.body.byteLength });
          }
          stored.add(url);
          if (encoded.body.byteLength > IMAGE_BUDGET_BYTES) {
            warnings.push(
              `${collection}/${id}: image ${url} is ${kilobytes(encoded.body.byteLength)} (budget ${kilobytes(IMAGE_BUDGET_BYTES)})`,
            );
          }
        }
        const entry: ImageManifestEntry = {
          url,
          wikiFile: image.file,
          version,
          rendition,
          width: encoded.width,
          height: encoded.height,
          bytes: encoded.body.byteLength,
        };
        entries.set(url, entry);
        resolved.set(base, imageOf(entry));
      } catch (error) {
        if (error instanceof BlockedError || error instanceof DisallowedUrlError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        const kept = fallback();
        stats.failed += 1;
        failures.push(`${collection}/${id}: ${image.file}: ${message}`);
        warnings.push(
          `${collection}/${id}: image ${image.file} failed (${message}); ${kept ? "kept the published image" : "no image"}`,
        );
        resolved.set(base, kept);
      }
    }
  }
  if (stats.failed > stats.requested * MAX_FAILURE_RATIO) {
    throw new ImageFailureError(failures);
  }
  if (offlineMisses > 0) {
    warnings.push(
      `images: ${offlineMisses} of ${stats.requested} pictures need a download, which offline runs skip: published images are kept, new entities get none`,
    );
  }

  // Attach to the scraped collections; a pattern's image is its first variant image.
  const dataset: Record<string, unknown> = { ...input.dataset };
  for (const [collection, requests] of input.requests) {
    const requested = new Set(requests.map(({ id, variant }) => `${id}\0${variant ?? ""}`));
    const entities = (input.dataset[collection] ?? []) as readonly Entity[];
    dataset[collection] = entities.map((entity) => {
      const image = (variant: PatternTarget | null) => {
        if (!requested.has(`${entity.id}\0${variant ?? ""}`)) {
          warnings.push(
            `${collection}/${entity.id}: no ${variant ? `${variant} ` : ""}image on the wiki`,
          );
          return null;
        }
        return resolved.get(keyBase(collection, entity.id, variant)) ?? null;
      };
      if (!entity.variants) {
        return { ...entity, image: image(null) };
      }
      const variants = entity.variants.map((variant) => ({
        ...variant,
        image: image(variant.target as PatternTarget),
      }));
      return {
        ...entity,
        image: variants.find((variant) => variant.image)?.image ?? null,
        variants,
      };
    });
  }

  // The manifest follows what the dataset references; expired orphans leave B2.
  const live = referencedImages(dataset as Dataset).flatMap((image) => {
    const entry = entries.get(image.url);
    return entry ? [entry] : [];
  });
  const next = nextManifest(previous, live, date);
  let manifest = next.manifest;
  if (backend && next.expired.length > 0) {
    const deleted = new Set<string>();
    for (const url of next.expired) {
      try {
        await backend.store.delete(url.slice(1));
        deleted.add(url);
      } catch (error) {
        warnings.push(
          `images: could not delete ${url} (${error instanceof Error ? error.message : String(error)}); retried next run`,
        );
      }
    }
    stats.deleted = deleted.size;
    manifest = withoutOrphans(manifest, deleted);
  }
  stats.images = manifest.images.length;
  stats.orphans = manifest.orphans.length;
  stats.bytes = manifest.images.reduce((sum, entry) => sum + entry.bytes, 0);

  const empty = manifest.images.length === 0 && manifest.orphans.length === 0;
  return { dataset: dataset as Dataset, manifest: empty ? null : manifest, warnings, stats };
}
