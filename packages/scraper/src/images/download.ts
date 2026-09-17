import type { ImageRendition } from "@hd2/schemas";
import type { HttpClient } from "../http/client.ts";
import type { RawImage } from "../parsers/raw.ts";
import { fitSize } from "./rendition.ts";

// Where a wiki picture is downloaded from (arch §6.5): SVG originals (rasterized here, never
// served), else the smallest standard thumbnail at least as wide as the output, or the original
// when no standard thumbnail is smaller than it. The version suffix is kept, as a browser does.

const THUMB_WIDTHS: readonly number[] = [256, 512, 1024, 2048];

export const isVector = (file: string) => /\.svg$/i.test(file);

/** `/images/A.png?97e7bb` → `97e7bb`; no suffix, or any other query → null. */
export function imageVersion(src: string): string | null {
  return /\?([a-f0-9]{1,32})$/.exec(src)?.[1] ?? null;
}

/** The file segment as the wiki encodes it (`Liberty%27s_Herald.png`), from a direct or thumb src. */
function encodedFile(src: string): string {
  const path = src.split(/[?#]/)[0] ?? "";
  const segment =
    /^\/images\/thumb\/([^/]+)\/[^/]+$/.exec(path)?.[1] ?? /^\/images\/([^/]+)$/.exec(path)?.[1];
  if (!segment) {
    throw new Error(`not a wiki file URL: ${src}`);
  }
  return segment;
}

export function downloadPath(image: RawImage, rendition: ImageRendition): string {
  const file = encodedFile(image.src);
  const version = imageVersion(image.src);
  const suffix = version ? `?${version}` : "";
  const original = `/images/${file}${suffix}`;
  if (isVector(image.file) || image.width === null || image.height === null) {
    return original;
  }
  const target = fitSize(image.width, image.height, rendition);
  const step = THUMB_WIDTHS.find((width) => width >= target.width);
  if (step === undefined || step >= image.width) {
    return original;
  }
  return `/images/thumb/${file}/${step}px-${file}${suffix}`;
}

export interface ImageFetcher {
  fetch(path: string): Promise<Buffer>;
}

/** Downloads through the polite client; a versioned URL already in the HTTP cache costs nothing. */
export class WikiImageFetcher implements ImageFetcher {
  constructor(readonly http: HttpClient) {}

  async fetch(path: string): Promise<Buffer> {
    return (await this.http.get(path, { immutable: true })).body;
  }
}
