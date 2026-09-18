import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ImageManifest } from "@hd2/schemas";
import { z } from "zod";
import { B2ReadEnv, B2Reader } from "./site/b2.ts";
import { pullImages } from "./site/images.ts";

// Usage: pnpm images:pull
// Downloads every live image of <DATA_DIR>/v1/reports/images.json that `.cache/images` lacks, with
// the B2 read key (B2_S3_ENDPOINT, B2_BUCKET, B2_READ_KEY_ID, B2_READ_APP_KEY from the environment,
// `.env` or `apps/api/.dev.vars`). `pnpm build` then copies them into `dist/images`.
const rootDir = join(import.meta.dirname, "..", "..", "..");
for (const file of [join(rootDir, ".env"), join(rootDir, "apps/api/.dev.vars")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const env = B2ReadEnv.safeParse(process.env);
if (!env.success) {
  console.error(`images: missing or invalid B2 configuration\n${z.prettifyError(env.error)}`);
  process.exit(1);
}

const dataDir = join(resolve(rootDir, process.env.DATA_DIR ?? "data"), "v1");
const manifest = ImageManifest.parse(
  JSON.parse(readFileSync(join(dataDir, "reports", "images.json"), "utf8")),
);
const urls = manifest.images.map((image) => image.url);

const reader = new B2Reader(env.data, (request) => fetch(request));
const result = await pullImages(urls, join(rootDir, ".cache", "images"), {
  async get(key) {
    const response = await reader.get(key);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`B2 answered HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  },
});

for (const line of result.failed.slice(0, 20)) console.error(`images: ${line}`);
console.log(
  `images: ${urls.length} live · ${result.cached} cached · ${result.downloaded} downloaded · ` +
    `${result.failed.length} failed`,
);
if (result.failed.length > 0) process.exitCode = 1;
