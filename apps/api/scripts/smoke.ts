import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runSmoke } from "./smoke/checks.ts";

// Usage: pnpm smoke --base <url> [--skip-images] [--data-version <v>] [--build-id <id>]
//        [--wait-seconds 120]
// The expected dataVersion defaults to <DATA_DIR>/v1/meta.json (DATA_DIR relative to the repo
// root) and the expected build id to the `X-Build-Id` of the built `dist/_headers`, so smoke
// waits for the deployment it was built from even when the dataset did not change.
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://helldivers-api.pages.dev" },
    "skip-images": { type: "boolean", default: false },
    "data-version": { type: "string" },
    "build-id": { type: "string" },
    "wait-seconds": { type: "string", default: "120" },
  },
});

const rootDir = join(import.meta.dirname, "..", "..", "..");
const metaFile = join(resolve(rootDir, process.env.DATA_DIR ?? "data"), "v1", "meta.json");
const dataVersion =
  values["data-version"] ??
  (JSON.parse(readFileSync(metaFile, "utf8")) as { dataVersion: string }).dataVersion;

const headersFile = join(import.meta.dirname, "..", "dist", "_headers");
const readBuildId = () => {
  try {
    return /^\s*X-Build-Id:\s*(\S+)/m.exec(readFileSync(headersFile, "utf8"))?.[1];
  } catch {
    return undefined; // no local build (a smoke run against a deployment from elsewhere)
  }
};
const buildId = values["build-id"] ?? readBuildId() ?? "dev";

console.log(
  `smoke · ${values.base} · expecting ${dataVersion}${buildId === "dev" ? "" : ` · ${buildId}`}`,
);
const failures = await runSmoke(
  {
    base: values.base,
    dataVersion,
    buildId,
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
