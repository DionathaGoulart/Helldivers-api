import { z } from "zod";
import { ImageUrl } from "./common.ts";

// `data/v1/reports/*.json`. Only the fields integrity needs today; the image
// pipeline (Phase 4) adds its own.

export const ImageManifest = z.object({
  images: z.array(z.object({ url: ImageUrl, wikiFile: z.string().min(1) })),
});

export type ImageManifest = z.infer<typeof ImageManifest>;
