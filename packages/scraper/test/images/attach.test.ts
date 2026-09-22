import type { Dataset, ImageManifest } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { attachImages, type ImageRequest } from "../../src/images/attach.ts";
import { silentLogger } from "../../src/log.ts";
import { fakeBackend } from "./fake-backend.ts";

// Step 7 on hand-made drafts; the E2E suite (run.test.ts) covers reuse, new versions, orphan
// expiry, offline runs and the failure ratio over the fixture pages.

const icon = (file: string, version = "1a2b3c") => ({
  file,
  src: `/images/${file}?${version}`,
  width: 512,
  height: 512,
});

const booster = (id: string) => ({ id, image: null });
const pattern = (id: string) => ({
  id,
  image: null,
  variants: ["hellpod", "shuttle"].map((target) => ({ target, image: null })),
});

const attach = (
  dataset: Record<string, unknown[]>,
  requests: [string, ImageRequest[]][],
  backend = fakeBackend(),
  previous: ImageManifest | null = null,
  date = "2026-09-17",
) =>
  attachImages({
    dataset: dataset as Dataset,
    published: {},
    requests: new Map(requests) as never,
    previous,
    backend,
    date,
    logger: silentLogger,
  });

describe("attachImages", () => {
  it("skips the PUT of a key B2 already holds", async () => {
    const backend = fakeBackend();
    const first = await attach(
      { boosters: [booster("a")] },
      [["boosters", [{ id: "a", variant: null, image: icon("A.svg") }]]],
      backend,
    );
    const key = (first.dataset.boosters?.[0]?.image?.url ?? "").slice(1);
    expect(backend.store.calls).toEqual([`HEAD ${key}`, `PUT ${key}`]);

    // Same bytes, manifest lost (a failed publish): HEAD finds the object.
    backend.store.calls.length = 0;
    const again = await attach(
      { boosters: [booster("a")] },
      [["boosters", [{ id: "a", variant: null, image: icon("A.svg") }]]],
      backend,
    );
    expect(backend.store.calls).toEqual([`HEAD ${key}`]);
    expect(again.stats).toMatchObject({ fetched: 1, uploaded: 0, images: 1 });
  });

  it("warns about images above the 150 KB budget and entities without a picture", async () => {
    const backend = fakeBackend();
    backend.encoder = {
      encode: async () => ({ body: Buffer.alloc(160 * 1024), width: 512, height: 288 }),
    };
    const result = await attach(
      { weapons: [booster("big"), booster("bare")] },
      [["weapons", [{ id: "big", variant: null, image: icon("Big.png") }]]],
      backend,
    );
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^weapons\/big: image \/images\/v1\/weapons\/big\.[a-f0-9]{8}\.webp is 160\.0 KB \(budget 150\.0 KB\)$/,
      ),
      "weapons/bare: no image on the wiki",
    ]);
    expect(result.stats.bytes).toBe(160 * 1024);
  });

  it("publishes no image for the wiki's placeholder picture", async () => {
    const backend = fakeBackend();
    const result = await attach(
      { stratagems: [booster("camera")] },
      [["stratagems", [{ id: "camera", variant: null, image: icon("Placeholder.png") }]]],
      backend,
    );
    expect(result.dataset.stratagems?.[0]?.image).toBeNull();
    expect(result.warnings).toEqual([
      "stratagems/camera: the wiki shows Placeholder.png, a stand-in; no image",
    ]);
    expect(backend.store.calls).toEqual([]);
    expect(result.stats).toMatchObject({ requested: 0, fetched: 0, images: 0 });
  });

  it("gives a pattern its first variant image and keys variants by target", async () => {
    const result = await attach({ patterns: [pattern("castellans-green")] }, [
      [
        "patterns",
        [{ id: "castellans-green", variant: "shuttle", image: icon("Green_Shuttle.png") }],
      ],
    ]);
    const [entity] = result.dataset.patterns ?? [];
    expect(entity?.variants[0]?.image).toBeNull();
    expect(entity?.variants[1]?.image?.url).toMatch(
      /^\/images\/v1\/patterns\/castellans-green-shuttle\.[a-f0-9]{8}\.webp$/,
    );
    expect(entity?.image).toEqual(entity?.variants[1]?.image);
    expect(result.warnings).toEqual(["patterns/castellans-green: no hellpod image on the wiki"]);
  });

  it("keeps an orphan whose deletion failed for the next run", async () => {
    const backend = fakeBackend();
    backend.store.delete = async () => {
      throw new Error("B2 DELETE failed: HTTP 503");
    };
    const url = "/images/v1/boosters/gone.0d15ea5e.webp";
    const result = await attach({ boosters: [] }, [["boosters", []]], backend, {
      images: [],
      orphans: [{ url, since: "2026-08-01" }],
    });
    expect(result.manifest).toEqual({ images: [], orphans: [{ url, since: "2026-08-01" }] });
    expect(result.stats.deleted).toBe(0);
    expect(result.warnings).toEqual([
      `images: could not delete ${url} (B2 DELETE failed: HTTP 503); retried next run`,
    ]);
  });
});
