import { z } from "zod";
import { Collection, Id, ImageUrl } from "./common.ts";

// `data/v1/reports/*.json`.

// Output size rule of an image (arch §6.5): `render` fits 512×512, `icon` is 256 wide,
// `card` is 512 tall, `cover` is 1024 wide. Rasters are never enlarged.
export const ImageRendition = z.enum(["render", "icon", "card", "cover"]);

// `reports/images.json`: the B2 upload manifest, committed with the data (arch §6.5).
export const ImageManifestEntry = z.object({
  url: ImageUrl, // `/images/v1/<collection>/<id>[-<variant>].<hash8>.webp` = B2 key `images/v1/…`
  wikiFile: z.string().min(1),
  version: z
    .string()
    .regex(/^[a-f0-9]+$/)
    .nullable(), // `?97e7bb` suffix of the wiki file URL; a new one means a new upload
  rendition: ImageRendition,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

// A key no entity references any more; deleted from B2 30 days after `since`.
export const ImageOrphan = z.object({ url: ImageUrl, since: z.iso.date() });

// Both lists sorted by url; a url is either live or orphaned.
export const ImageManifest = z.object({
  images: z.array(ImageManifestEntry),
  orphans: z.array(ImageOrphan),
});

// `reports/conflicts.json` (arch §5.5): two wiki values for one field and the one kept.
export const ConflictValue = z.union([
  z.number(),
  z.string(),
  z.array(z.number()),
  z.object({ currency: z.string(), amount: z.number() }),
  z.null(),
]);

export const Conflict = z.object({
  collection: Collection,
  id: Id,
  field: z.string().min(1), // entity path, "firearm.recoil"
  rule: z.number().int().positive(), // arch §5.5 rule number
  chosen: ConflictValue,
  candidates: z
    .array(
      z.object({
        page: z.url(), // wiki page the value was read from
        location: z.string().min(1), // "infobox › Recoil", "AR-23 LIBERATOR › Recoil"
        value: ConflictValue,
      }),
    )
    .min(2),
});

// Sorted by collection, id and field.
export const ConflictReport = z.object({ conflicts: z.array(Conflict) });

export type ImageRendition = z.infer<typeof ImageRendition>;
export type ImageManifestEntry = z.infer<typeof ImageManifestEntry>;
export type ImageOrphan = z.infer<typeof ImageOrphan>;
export type ImageManifest = z.infer<typeof ImageManifest>;
export type ConflictValue = z.infer<typeof ConflictValue>;
export type Conflict = z.infer<typeof Conflict>;
export type ConflictReport = z.infer<typeof ConflictReport>;
