import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { B2CheckEnv, runB2Check } from "./b2/check.ts";

// Usage: pnpm tsx scripts/b2-check.ts
// Reads the write key from .env and the read key from apps/api/.dev.vars.
const root = join(import.meta.dirname, "..");
for (const file of [join(root, ".env"), join(root, "apps/api/.dev.vars")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

const env = B2CheckEnv.safeParse(process.env);
if (!env.success) {
  console.error(`b2-check: missing or invalid configuration\n${z.prettifyError(env.error)}`);
  process.exit(1);
}

try {
  await runB2Check(env.data, {
    fetch: (request) => fetch(request),
    now: Date.now,
    log: (line) => console.log(line),
  });
} catch (error) {
  console.error(`b2-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
