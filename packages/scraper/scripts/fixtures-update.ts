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

// Usage: pnpm fixtures:update --pages Boosters,Hellpod_Space_Optimization
// Saves wiki HTML for parser tests through the same polite client as `pnpm scrape`
// (arch §11): test/fixtures/wiki/<Title>.html, robots.txt and manifest.json.

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

const root = join(import.meta.dirname, "..", "..", "..");
const fixturesDir = join(import.meta.dirname, "..", "test", "fixtures", "wiki");
const manifestPath = join(fixturesDir, "manifest.json");

const { values } = parseArgs({ options: { pages: { type: "string" } } });
const titles = [...new Set((values.pages ?? "").split(",").map(normalizeTitle).filter(Boolean))];
if (titles.length === 0) {
  console.error("usage: pnpm fixtures:update --pages <Title,Title…>");
  process.exit(1);
}

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
  plannedUrls: titles.map((title) => wikiUrl(title)),
});
http.useRobots(policy);

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

const pages = Object.fromEntries(
  Object.entries(manifest.pages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
await writeFile(manifestPath, `${JSON.stringify({ pages }, null, 2)}\n`);

const { requests, notModified } = http.stats;
console.log(
  `fixtures:update ok · ${titles.length} pages · ${requests} requests (${notModified} not modified)`,
);
