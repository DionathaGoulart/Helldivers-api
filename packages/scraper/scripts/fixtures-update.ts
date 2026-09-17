import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ACCEPTED_CONTENT_SIGNALS, ScraperEnv } from "../src/config.ts";
import { HttpCache } from "../src/http/cache.ts";
import { HttpClient } from "../src/http/client.ts";
import { DEFAULT_PACING } from "../src/http/queue.ts";
import { checkRobots, parseRobots } from "../src/http/robots.ts";
import { jsonLogger } from "../src/log.ts";
import { OnlineSource } from "../src/source.ts";
import { readRevisionId } from "../src/wiki/revision.ts";
import { fixtureFileName, normalizeTitle, wikiUrl } from "../src/wiki/title.ts";

// Usage: pnpm fixtures:update [--pages Boosters,Hellpod_Space_Optimization] [--images A.svg,B.png]
// Saves wiki HTML for parser tests through the same polite client as `pnpm scrape`
// (arch §11): test/fixtures/wiki/<Title>.html, robots.txt and manifest.json; and original wiki
// files for the image encoder tests: test/fixtures/images/<File> and manifest.json.

const FixtureManifest = z.object({
  pages: z.record(
    z.string(),
    z.object({
      file: z.string(),
      url: z.url(),
      fetchedAt: z.iso.datetime(),
      lastModified: z.string().nullable(),
      wgRevisionId: z.number().int().nullable(),
    }),
  ),
});

const ImageFixtureManifest = z.object({
  images: z.record(z.string(), z.object({ url: z.url(), fetchedAt: z.iso.datetime() })),
});

const root = join(import.meta.dirname, "..", "..", "..");
const fixturesDir = join(import.meta.dirname, "..", "test", "fixtures", "wiki");
const manifestPath = join(fixturesDir, "manifest.json");
const imagesDir = join(import.meta.dirname, "..", "test", "fixtures", "images");
const imagesManifestPath = join(imagesDir, "manifest.json");

const { values } = parseArgs({
  options: { pages: { type: "string" }, images: { type: "string" } },
});
const list = (value: string | undefined) =>
  [...new Set((value ?? "").split(",").map((item) => item.trim()))].filter(Boolean);
const titles = list(values.pages).map(normalizeTitle);
const files = list(values.images).map((file) => file.replaceAll(" ", "_"));
if (titles.length === 0 && files.length === 0) {
  console.error("usage: pnpm fixtures:update [--pages <Title,Title…>] [--images <File,File…>]");
  process.exit(1);
}
const filePath = (file: string) => `/images/${encodeURIComponent(file).replaceAll("'", "%27")}`;

if (existsSync(join(root, ".env"))) {
  process.loadEnvFile(join(root, ".env"));
}
const env = ScraperEnv.parse(process.env);
const http = new HttpClient({
  baseUrl: env.WIKI_BASE_URL,
  userAgent: env.SCRAPER_USER_AGENT,
  pacing: { ...DEFAULT_PACING, delayMs: env.SCRAPER_DELAY_MS },
  cache: new HttpCache(join(root, ".cache", "http")),
  fullRefresh: env.SCRAPER_FULL_REFRESH,
  logger: jsonLogger(),
});
const source = new OnlineSource(http);

const robotsTxt = await source.robotsTxt();
const policy = parseRobots(
  new URL("/robots.txt", env.WIKI_BASE_URL).href,
  robotsTxt,
  env.SCRAPER_USER_AGENT,
);
checkRobots(policy, {
  acceptedSignals: ACCEPTED_CONTENT_SIGNALS,
  plannedUrls: [
    ...titles.map((title) => wikiUrl(title)),
    ...files.map((file) => new URL(filePath(file), env.WIKI_BASE_URL).href),
  ],
});
http.useRobots(policy);

const sorted = <T>(record: Record<string, T>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

if (titles.length > 0) {
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(join(fixturesDir, "robots.txt"), robotsTxt);
  const manifest = existsSync(manifestPath)
    ? FixtureManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")))
    : { pages: {} };
  for (const title of titles) {
    const page = await source.page(title);
    const file = fixtureFileName(title);
    await writeFile(join(fixturesDir, file), page.html);
    manifest.pages[title] = {
      file,
      url: page.url,
      fetchedAt: new Date().toISOString(),
      lastModified: page.lastModified,
      wgRevisionId: readRevisionId(page.html),
    };
  }
  await writeFile(manifestPath, `${JSON.stringify({ pages: sorted(manifest.pages) }, null, 2)}\n`);
}

if (files.length > 0) {
  await mkdir(imagesDir, { recursive: true });
  const manifest = existsSync(imagesManifestPath)
    ? ImageFixtureManifest.parse(JSON.parse(await readFile(imagesManifestPath, "utf8")))
    : { images: {} };
  for (const file of files) {
    const result = await http.get(filePath(file));
    await writeFile(join(imagesDir, file), result.body);
    manifest.images[file] = { url: result.url, fetchedAt: new Date().toISOString() };
  }
  await writeFile(
    imagesManifestPath,
    `${JSON.stringify({ images: sorted(manifest.images) }, null, 2)}\n`,
  );
}

const { requests, notModified } = http.stats;
console.log(
  `fixtures:update ok · ${titles.length} pages · ${files.length} images · ${requests} requests (${notModified} not modified)`,
);
