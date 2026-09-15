import { z } from "zod";

// Scraper configuration from the environment (arch §10, `.env.example`).

export const DEFAULT_USER_AGENT =
  "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)";

// robots.txt `Content-Signal` observed on 2026-09-15 (arch §4.1). A change fails the preflight.
export const EXPECTED_CONTENT_SIGNALS: readonly string[] = ["search=yes,ai-train=no,use=reference"];

// Workflow inputs arrive as "true" / "false", or "" on scheduled runs.
const Flag = z
  .enum(["", "true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

export const ScraperEnv = z.object({
  WIKI_BASE_URL: z.url({ protocol: /^https$/ }).default("https://helldivers.wiki.gg"),
  SCRAPER_DELAY_MS: z.coerce
    .number()
    .int()
    .min(3_000, "never below 3000 ms between requests (arch §6.2)")
    .default(3_000),
  SCRAPER_USER_AGENT: z.string().trim().min(1).default(DEFAULT_USER_AGENT),
  DATA_DIR: z.string().min(1).default("data"),
  SCRAPER_FULL_REFRESH: Flag.default(false),
  SCRAPER_ALLOW_DROP: Flag.default(false),
  SCRAPER_ONLY: z.string().default(""),
});

export type ScraperEnv = z.infer<typeof ScraperEnv>;
