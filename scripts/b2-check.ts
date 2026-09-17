import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { B2CheckEnv, B2ReadEnv, runB2Check, runB2KeyCheck } from "./b2/check.ts";

// Usage: pnpm tsx scripts/b2-check.ts [--key images/v1/<collection>/<id>.<hash8>.webp]
// Reads the write key from .env and the read key from apps/api/.dev.vars. With --key, only
// reads that uploaded image with the read key.
const root = join(import.meta.dirname, "..");
for (const file of [join(root, ".env"), join(root, "apps/api/.dev.vars")]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

const { values } = parseArgs({ options: { key: { type: "string" } } });
const env = (values.key ? B2ReadEnv : B2CheckEnv).safeParse(process.env);
if (!env.success) {
  console.error(`b2-check: missing or invalid configuration\n${z.prettifyError(env.error)}`);
  process.exit(1);
}

const deps = {
  fetch: (request: Request) => fetch(request),
  log: (line: string) => console.log(line),
};
try {
  if (values.key) {
    await runB2KeyCheck(env.data, values.key, deps);
  } else {
    await runB2Check(env.data as B2CheckEnv, { ...deps, now: Date.now });
  }
} catch (error) {
  console.error(`b2-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
