import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runSmoke } from "./smoke/checks.ts";

// Usage: pnpm smoke --base <url> [--skip-images] [--data-version <v>] [--wait-seconds 120]
// The expected dataVersion defaults to <DATA_DIR>/v1/meta.json (DATA_DIR relative to the repo root).
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://helldivers-api.pages.dev" },
    "skip-images": { type: "boolean", default: false },
    "data-version": { type: "string" },
    "wait-seconds": { type: "string", default: "120" },
  },
});

const rootDir = join(import.meta.dirname, "..", "..", "..");
const metaFile = join(resolve(rootDir, process.env.DATA_DIR ?? "data"), "v1", "meta.json");
const dataVersion =
  values["data-version"] ??
  (JSON.parse(readFileSync(metaFile, "utf8")) as { dataVersion: string }).dataVersion;

console.log(`smoke · ${values.base} · expecting ${dataVersion}`);
const failures = await runSmoke(
  {
    base: values.base,
    dataVersion,
    skipImages: values["skip-images"],
    waitMs: Number(values["wait-seconds"]) * 1000,
    retryMs: 10_000,
  },
  {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => performance.now(),
    log: (line) => console.log(line),
  },
);
if (failures.length > 0) {
  console.error(`smoke: ${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("smoke ok");
}
