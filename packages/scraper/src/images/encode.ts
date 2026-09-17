import type { ImageRendition } from "@hd2/schemas";
import sharp from "sharp";
import { fitSize } from "./rendition.ts";

// Wiki picture → WebP (arch §6.5). Pinned sharp and fixed options keep the bytes, and so the
// content-hashed keys, stable for the same input.

export interface EncodedImage {
  body: Buffer;
  width: number;
  height: number;
}

export interface ImageEncoder {
  encode(input: Buffer, rendition: ImageRendition, vector: boolean): Promise<EncodedImage>;
}

const WEBP_OPTIONS = { quality: 85, effort: 4 } as const;

export const sharpEncoder: ImageEncoder = {
  async encode(input, rendition, vector) {
    const meta = await sharp(input, { failOn: "error" }).metadata();
    if (!meta.width || !meta.height) {
      throw new Error("the file has no size");
    }
    const target = fitSize(meta.width, meta.height, rendition, vector);
    // SVGs render at 72 dpi; a higher density draws them at the output size instead of
    // enlarging a smaller bitmap.
    const density = vector ? 72 * Math.max(1, target.width / meta.width) : undefined;
    let image = sharp(input, { failOn: "error", ...(density ? { density } : {}) });
    if (target.width !== meta.width || target.height !== meta.height) {
      image = image.resize(target.width, target.height, { fit: "fill", kernel: "lanczos3" });
    }
    const { data, info } = await image.webp(WEBP_OPTIONS).toBuffer({ resolveWithObject: true });
    return { body: data, width: info.width, height: info.height };
  },
};
