import { z } from "zod";
import { Collection, Id, ImageUrl } from "./common.ts";

// `data/v1/reports/*.json`. Only the fields integrity needs today; the image
// pipeline (Phase 4) adds its own.

export const ImageManifest = z.object({
  images: z.array(z.object({ url: ImageUrl, wikiFile: z.string().min(1) })),
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

export type ImageManifest = z.infer<typeof ImageManifest>;
export type ConflictValue = z.infer<typeof ConflictValue>;
export type Conflict = z.infer<typeof Conflict>;
export type ConflictReport = z.infer<typeof ConflictReport>;
