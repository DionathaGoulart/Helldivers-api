import type { ImageManifest, ImageManifestEntry, ImageOrphan } from "@hd2/schemas";

// `reports/images.json` from one run to the next (arch §6.5): live entries are the images the
// dataset references; a key that leaves them becomes an orphan and is deleted from B2 once it
// has been unreferenced for 30 days, so clients holding an old URL keep working meanwhile.

export const ORPHAN_GRACE_DAYS = 30;

const byUrl = <T extends { url: string }>(a: T, b: T) =>
  a.url < b.url ? -1 : a.url > b.url ? 1 : 0;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface NextManifest {
  manifest: ImageManifest;
  expired: string[]; // orphan urls due for deletion
}

/** `live` = entries of every image the next dataset references; `date` = the run's UTC date. */
export function nextManifest(
  previous: ImageManifest | null,
  live: readonly ImageManifestEntry[],
  date: string,
): NextManifest {
  const images = [...new Map(live.map((entry) => [entry.url, entry])).values()].sort(byUrl);
  const liveUrls = new Set(images.map((entry) => entry.url));

  const orphans = new Map<string, ImageOrphan>();
  for (const orphan of previous?.orphans ?? []) {
    if (!liveUrls.has(orphan.url)) {
      orphans.set(orphan.url, orphan);
    }
  }
  for (const entry of previous?.images ?? []) {
    if (!liveUrls.has(entry.url) && !orphans.has(entry.url)) {
      orphans.set(entry.url, { url: entry.url, since: date });
    }
  }
  const sorted = [...orphans.values()].sort(byUrl);
  return {
    manifest: { images, orphans: sorted },
    expired: sorted
      .filter((orphan) => daysBetween(orphan.since, date) >= ORPHAN_GRACE_DAYS)
      .map((orphan) => orphan.url),
  };
}

/** The manifest without the orphans whose B2 objects were deleted. */
export function withoutOrphans(
  manifest: ImageManifest,
  deleted: ReadonlySet<string>,
): ImageManifest {
  return {
    images: manifest.images,
    orphans: manifest.orphans.filter((orphan) => !deleted.has(orphan.url)),
  };
}
