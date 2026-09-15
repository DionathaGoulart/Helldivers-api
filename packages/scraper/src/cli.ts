import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Collection } from "@hd2/schemas";
import { z } from "zod";
import { ScraperEnv } from "./config.ts";
import { HttpCache } from "./http/cache.ts";
import { HttpClient } from "./http/client.ts";
import { DEFAULT_PACING } from "./http/queue.ts";
import { jsonLogger } from "./log.ts";
import { writeReports } from "./publish/report.ts";
import { runScrape } from "./run.ts";
import { FixtureSource, OnlineSource } from "./source.ts";

// Usage: pnpm scrape [--only boosters] [--offline] [--full-refresh] [--allow-drop] [--report .reports]
// Flags win over the SCRAPER_ONLY / SCRAPER_FULL_REFRESH / SCRAPER_ALLOW_DROP env (scrape.yml).

const root = join(import.meta.dirname, "..", "..", "..");
const cwd = process.env.INIT_CWD ?? process.cwd();

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    offline: { type: "boolean", default: false },
    "full-refresh": { type: "boolean", default: false },
    "allow-drop": { type: "boolean", default: false },
    report: { type: "string", default: ".reports" },
  },
});

if (existsSync(join(root, ".env"))) {
  process.loadEnvFile(join(root, ".env"));
}
const env = ScraperEnv.safeParse(process.env);
if (!env.success) {
  console.error(`scrape: invalid configuration\n${z.prettifyError(env.error)}`);
  process.exit(1);
}

const onlyList = (values.only ?? env.data.SCRAPER_ONLY)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const only = z.array(Collection).safeParse(onlyList);
if (!only.success) {
  console.error(`scrape: --only: ${z.prettifyError(only.error)}`);
  process.exit(1);
}

const fullRefresh = values["full-refresh"] || env.data.SCRAPER_FULL_REFRESH;
const logger = jsonLogger();
const http = values.offline
  ? null
  : new HttpClient({
      baseUrl: env.data.WIKI_BASE_URL,
      userAgent: env.data.SCRAPER_USER_AGENT,
      pacing: { ...DEFAULT_PACING, delayMs: env.data.SCRAPER_DELAY_MS },
      cache: new HttpCache(join(root, ".cache", "http")),
      fullRefresh,
      logger,
    });

const report = await runScrape({
  dataDir: resolve(cwd, env.data.DATA_DIR),
  source: http
    ? new OnlineSource(http)
    : new FixtureSource(join(root, "packages", "scraper", "test", "fixtures", "wiki")),
  http,
  only: only.data.length > 0 ? only.data : null,
  allowDrop: values["allow-drop"] || env.data.SCRAPER_ALLOW_DROP,
  fullRefresh,
  baseUrl: env.data.WIKI_BASE_URL,
  userAgent: env.data.SCRAPER_USER_AGENT,
  now: () => new Date(),
  logger,
});

await writeReports(resolve(cwd, values.report), report);
logger.info("scrape done", {
  ok: report.ok,
  changed: report.changed,
  dataVersion: report.dataVersion,
  changes: report.changes.length,
  failure: report.failure?.kind ?? null,
  requests: report.http?.requests ?? 0,
  notModified: report.http?.notModified ?? 0,
});
process.exitCode = report.ok ? 0 : 1;
