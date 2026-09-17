import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Collection } from "@hd2/schemas";
import type { BuildInfo } from "../src/build-info.ts";
import { B2Reader } from "../src/lib/b2.ts";
import type { ListFile } from "../src/lib/data-loader.ts";
import { parseQuery, queryBody } from "../src/routes/query.ts";
import { parseSearch, searchBody } from "../src/routes/search.ts";
import type { SearchIndex } from "../src/search-index.ts";
import { referencedCollections } from "../src/spec/filters.ts";

// Usage: pnpm build && pnpm --filter @hd2/api exec tsx scripts/bench.ts
// CPU of the Functions' work on the real dataset, measured in Node (V8, like workerd). Workers
// bill CPU, not the time spent waiting on ASSETS or B2 (arch §8.4).
const distDir = join(import.meta.dirname, "..", "dist");
const read = (path: string) => readFileSync(join(distDir, path), "utf8");

const RUNS = 30;
async function median(run: () => unknown | Promise<unknown>): Promise<number> {
  for (let i = 0; i < 5; i++) await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)] ?? 0;
}

const rows: [string, number][] = [];
const record = (name: string, ms: number) => {
  rows.push([name, ms]);
};

// Cold isolate: module evaluation of the bundle (zod schemas, Hono routes) in a fresh process.
{
  const script = `const t = performance.now(); await import(${JSON.stringify(pathToFileURL(join(distDir, "_worker.js")).href)}); console.log(performance.now() - t);`;
  const times = Array.from({ length: 5 }, () =>
    Number(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }),
    ),
  ).sort((a, b) => a - b);
  record("isolate start: evaluate _worker.js (fresh process, median of 5)", times[2] ?? 0);
}

const meta = JSON.parse(read("v1/meta.json")) as { dataVersion: string; generatedAt: string };
const lists = new Map<Collection, ListFile<never>>();
for (const collection of Collection.options) {
  const text = read(`v1/${collection}.json`);
  lists.set(collection, JSON.parse(text));
  if (["stratagems", "weapons", "warbonds"].includes(collection)) {
    record(
      `parse ${collection}.json (${(text.length / 1024).toFixed(0)} KB, once per isolate)`,
      await median(() => JSON.parse(text)),
    );
  }
}
const ids = Object.fromEntries(
  referencedCollections().map((collection) => [
    collection,
    ((lists.get(collection)?.data ?? []) as { id: string }[]).map((entity) => entity.id),
  ]),
);
const build: BuildInfo = { dataVersion: meta.dataVersion, generatedAt: meta.generatedAt, ids };

const queries: [Collection, string][] = [
  ["stratagems", "sort=-name&limit=100"],
  ["stratagems", "q=st&sort=-name&limit=100"],
  [
    "weapons",
    "category=primary,secondary&source=warbond,superstore,default&sort=name&fields=id,name,firearm",
  ],
  ["armors", "warbond=castellans-creed,helldivers-mobilize&weight=light,medium,heavy&q=er"],
];
for (const [collection, search] of queries) {
  const list = lists.get(collection);
  if (!list) continue;
  record(
    `query ${collection}?${search} (parse params + filter + sort + page + JSON)`,
    await median(() => {
      const parsed = parseQuery(collection, new URLSearchParams(search), build.ids);
      if (!parsed.ok) throw new Error(parsed.problem.detail);
      return JSON.stringify(queryBody(collection, list, parsed.value, build));
    }),
  );
}

const indexText = read("v1/search-index.json");
record(
  `parse search-index.json (${(indexText.length / 1024).toFixed(0)} KB, once per isolate)`,
  await median(() => JSON.parse(indexText)),
);
const index = JSON.parse(indexText) as SearchIndex;
for (const q of ["st", "liberator"]) {
  record(
    `search q=${q} limit=50`,
    await median(() => {
      const parsed = parseSearch(new URLSearchParams({ q, limit: "50" }));
      if (!parsed.ok) throw new Error(parsed.problem.detail);
      return JSON.stringify(searchBody(index, parsed.value, build));
    }),
  );
}

const env = {
  B2_S3_ENDPOINT: "https://s3.us-east-005.backblazeb2.com",
  B2_BUCKET: "Helldivers-api",
  B2_READ_KEY_ID: "005000000000000000000000",
  B2_READ_APP_KEY: "K005000000000000000000000000000",
};
const key = "images/v1/weapons/ar-23-liberator.932ff63d.webp";
const noFetch = async () => new Response(null);
record(
  "image miss: SigV4 signature with a new signer (first image of an isolate)",
  await median(() => new B2Reader(env, noFetch).get(key)),
);
{
  const reader = new B2Reader(env, noFetch);
  record("image miss: SigV4 signature with a warm signer", await median(() => reader.get(key)));
}

const width = Math.max(...rows.map(([name]) => name.length));
console.log(`bench · ${meta.dataVersion} · Node ${process.version} · median of ${RUNS}`);
for (const [name, ms] of rows) console.log(`${name.padEnd(width)}  ${ms.toFixed(2)} ms`);
