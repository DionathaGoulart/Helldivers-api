import { z } from "zod";
import { DRILLS } from "./drill.ts";

// Scraper configuration from the environment (arch §10, `.env.example`).

export const DEFAULT_USER_AGENT =
  "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)";

// robots.txt `Content-Signal` sets reviewed so far (arch §4.1); any other set fails the preflight.
// 2026-09-15: Cloudflare's managed block with the signal. 2026-09-16: block gone, no signal.
export const ACCEPTED_CONTENT_SIGNALS: readonly (readonly string[])[] = [
  ["search=yes,ai-train=no,use=reference"],
  [],
];

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
  // Failure rehearsals (`src/drill.ts`); empty on every real run.
  SCRAPER_DRILL: z.enum(["", ...DRILLS]).default(""),
  // Private B2 bucket with the write key; required by online runs (arch §6.5).
  B2_S3_ENDPOINT: z.url({ protocol: /^https$/ }).optional(),
  B2_BUCKET: z.string().min(1).optional(),
  B2_WRITE_KEY_ID: z.string().min(1).optional(),
  B2_WRITE_APP_KEY: z.string().min(1).optional(),
});

export type ScraperEnv = z.infer<typeof ScraperEnv>;
