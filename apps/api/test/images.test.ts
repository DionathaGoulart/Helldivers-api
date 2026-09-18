import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyImages, hashMatches, imagePath, pullImages } from "../scripts/site/images.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const urlFor = (id: string, body: Uint8Array) =>
  `/images/v1/boosters/${id}.${createHash("sha256").update(body).digest("hex").slice(0, 8)}.webp`;

const A = bytes("image a");
const B = bytes("image b");
const URL_A = urlFor("a", A);
const URL_B = urlFor("b", B);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hd2-images-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** B2 stand-in: serves `objects` by key and records every key asked for. */
function source(objects: Record<string, Uint8Array>) {
  const keys: string[] = [];
  return {
    keys,
    async get(key: string) {
      keys.push(key);
      const body = objects[key];
      if (!body) throw new Error("B2 answered HTTP 404");
      return body;
    },
  };
}

describe("hashMatches", () => {
  it("checks the bytes against the hash in the file name", () => {
    expect(hashMatches(URL_A, A)).toBe(true);
    expect(hashMatches(URL_A, B)).toBe(false);
    expect(hashMatches("/images/v1/boosters/a.webp", A)).toBe(false);
  });
});

describe("pullImages", () => {
  it("downloads only what the cache lacks and verifies it", async () => {
    const cache = join(dir, "cache");
    const b2 = source({ [URL_A.slice(1)]: A, [URL_B.slice(1)]: B });
    expect(await pullImages([URL_A, URL_B], cache, b2)).toEqual({
      cached: 0,
      downloaded: 2,
      failed: [],
    });
    expect(await readFile(imagePath(cache, URL_A))).toEqual(Buffer.from(A));

    b2.keys.length = 0;
    expect(await pullImages([URL_A, URL_B], cache, b2)).toEqual({
      cached: 2,
      downloaded: 0,
      failed: [],
    });
    expect(b2.keys).toEqual([]);
  });

  it("refetches a corrupt cached file and reports what B2 cannot give", async () => {
    const cache = join(dir, "cache");
    await pullImages([URL_A], cache, source({ [URL_A.slice(1)]: A }));
    await writeFile(imagePath(cache, URL_A), "truncated");
    const b2 = source({ [URL_A.slice(1)]: A, [URL_B.slice(1)]: A }); // B answers the wrong bytes
    const result = await pullImages([URL_A, URL_B, urlFor("c", bytes("c"))], cache, b2, 1);
    expect(result.downloaded).toBe(1);
    expect(result.failed).toEqual([
      `${URL_B}: bytes do not match the hash in the name`,
      `${urlFor("c", bytes("c"))}: B2 answered HTTP 404`,
    ]);
  });
});

describe("copyImages", () => {
  it("copies verified images and lists the missing ones", async () => {
    const cache = join(dir, "cache");
    await pullImages([URL_A], cache, source({ [URL_A.slice(1)]: A }));
    const dist = join(dir, "dist");
    expect(await copyImages([URL_A, URL_B], cache, dist)).toEqual({ copied: 1, missing: [URL_B] });
    expect(await readFile(join(dist, "images/v1/boosters", URL_A.split("/").at(-1) ?? ""))).toEqual(
      Buffer.from(A),
    );
  });
});
