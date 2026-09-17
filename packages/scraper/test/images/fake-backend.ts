import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageBackend } from "../../src/images/attach.ts";
import type { ImageStore } from "../../src/images/b2.ts";
import type { ImageFetcher } from "../../src/images/download.ts";
import type { ImageEncoder } from "../../src/images/encode.ts";
import { fitSize } from "../../src/images/rendition.ts";
import { FIXTURES_DIR } from "../fixtures.ts";

// An image backend without network or sharp: the fetcher answers with the file's original size
// read from the fixture pages, the encoder "encodes" the request path into bytes of the fitted
// size. Keys stay stable across platforms, so E2E snapshots can hold image URLs.

let sizes: Map<string, { width: number; height: number }> | undefined;

/** Original size of every picture the fixture pages show, by encoded file name. */
function fixtureSizes() {
  if (!sizes) {
    sizes = new Map();
    for (const name of readdirSync(FIXTURES_DIR).filter((file) => file.endsWith(".html"))) {
      const html = readFileSync(join(FIXTURES_DIR, name), "utf8");
      for (const [tag] of html.matchAll(/<img [^>]*data-file-width="\d+"[^>]*>/g)) {
        const src = /src="([^"?]+)/.exec(tag)?.[1] ?? "";
        const file = /^\/images\/(?:thumb\/)?([^/]+)/.exec(src)?.[1];
        const width = Number(/data-file-width="(\d+)"/.exec(tag)?.[1]);
        const height = Number(/data-file-height="(\d+)"/.exec(tag)?.[1]);
        if (file) sizes.set(file, { width, height });
      }
    }
  }
  return sizes;
}

export class MemoryStore implements ImageStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly calls: string[] = [];
  failPut: (key: string) => boolean = () => false;

  async exists(key: string) {
    this.calls.push(`HEAD ${key}`);
    return this.objects.has(key);
  }

  async put(key: string, body: Uint8Array) {
    this.calls.push(`PUT ${key}`);
    if (this.failPut(key)) throw new Error("HTTP 503");
    this.objects.set(key, body);
  }

  async delete(key: string) {
    this.calls.push(`DELETE ${key}`);
    this.objects.delete(key);
  }
}

export interface FakeBackend extends ImageBackend {
  store: MemoryStore;
  fetched: string[];
}

/** `fail(path)` makes a download throw, like a wiki 404. */
export function fakeBackend(fail: (path: string) => boolean = () => false): FakeBackend {
  const fetched: string[] = [];
  const fetcher: ImageFetcher = {
    async fetch(path) {
      fetched.push(path);
      if (fail(path)) throw new Error(`GET ${path} failed: HTTP 404`);
      const file = /^\/images\/(?:thumb\/)?([^/?]+)/.exec(path)?.[1] ?? "";
      const size = fixtureSizes().get(file) ?? { width: 512, height: 512 };
      return Buffer.from(JSON.stringify({ path, ...size }));
    },
  };
  const encoder: ImageEncoder = {
    async encode(input, rendition, vector) {
      const { path, width, height } = JSON.parse(input.toString()) as {
        path: string;
        width: number;
        height: number;
      };
      const size = fitSize(width, height, rendition, vector);
      return { body: Buffer.from(`webp ${rendition} ${path}`), ...size };
    },
  };
  return { fetcher, encoder, store: new MemoryStore(), fetched };
}
