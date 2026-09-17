import type { ImageManifestEntry } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { nextManifest, ORPHAN_GRACE_DAYS, withoutOrphans } from "../../src/images/manifest.ts";

describe("nextManifest", () => {
  const entry = (url: string): ImageManifestEntry => ({
    url,
    wikiFile: "A.png",
    version: "1a",
    rendition: "render",
    width: 512,
    height: 288,
    bytes: 1000,
  });
  const A = "/images/v1/weapons/a.00000001.webp";
  const A2 = "/images/v1/weapons/a.00000002.webp";
  const B = "/images/v1/weapons/b.00000001.webp";

  it("lists live images by url and turns the ones that left into orphans", () => {
    const { manifest, expired } = nextManifest(
      { images: [entry(A), entry(B)], orphans: [] },
      [entry(B), entry(A2), entry(A2)],
      "2026-09-17",
    );
    expect(manifest).toEqual({
      images: [entry(A2), entry(B)],
      orphans: [{ url: A, since: "2026-09-17" }],
    });
    expect(expired).toEqual([]);
  });

  it("keeps the first orphan date, revives a referenced orphan and expires after 30 days", () => {
    const previous = {
      images: [entry(A2)],
      orphans: [
        { url: A, since: "2026-08-18" },
        { url: B, since: "2026-08-19" },
      ],
    };
    expect(ORPHAN_GRACE_DAYS).toBe(30);
    const { manifest, expired } = nextManifest(previous, [entry(A2), entry(B)], "2026-09-17");
    expect(manifest.orphans).toEqual([{ url: A, since: "2026-08-18" }]);
    expect(expired).toEqual([A]);
    expect(nextManifest(previous, [entry(A2)], "2026-09-17").expired).toEqual([A]);
    expect(nextManifest(previous, [entry(A2)], "2026-09-18").expired).toEqual([A, B]);
    expect(withoutOrphans(manifest, new Set([A]))).toEqual({
      images: [entry(A2), entry(B)],
      orphans: [],
    });
  });
});
