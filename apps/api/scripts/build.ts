import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataset } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { bundleWorker } from "./site/bundle.ts";
import { checkDist } from "./site/checks.ts";
import { buildSite } from "./site/site.ts";

// Usage: pnpm build   (reads <DATA_DIR>/v1; DATA_DIR defaults to data, relative to the repo root)
// dist/ = the static assets: apps/docs pages + a copy of data/v1 + generated files (facets, CSV,
// search index, schemas, openapi.json, _headers, _redirects). build/worker.js = the Worker (arch §8).
const appDir = join(import.meta.dirname, "..");
const rootDir = join(appDir, "..", "..");
const distDir = join(appDir, "dist");
const workerFile = join(appDir, "build", "worker.js");
const docsDir = join(appDir, "..", "docs");
const dataDir = join(resolve(rootDir, process.env.DATA_DIR ?? "data"), "v1");

// Self-hosted docs font (styleguide §3): the latin subsets of the variable family, copied out of
// the package so `apps/docs` stays free of binaries and the page loads no third-party font.
const FONT_FILES = [
  "jetbrains-mono-latin-wght-normal.woff2",
  "jetbrains-mono-latin-ext-wght-normal.woff2",
  "jetbrains-mono-latin-wght-italic.woff2",
  "jetbrains-mono-latin-ext-wght-italic.woff2",
];

const fail = (lines: string[]) => {
  for (const line of lines.slice(0, 50)) console.error(`build: ${line}`);
  if (lines.length > 50) console.error(`build: … ${lines.length - 50} more`);
  process.exit(1);
};

// A schema failure fails the build (arch §0.2).
const { files, issues } = await readDatasetFiles(dataDir);
issues.push(...validateDataset(files));
if (issues.length > 0) {
  fail(
    issues.map((issue) => `${issue.file}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`),
  );
}

// GitHub sets GITHUB_SHA; a local build is `dev`, which smoke does not gate on.
const site = buildSite(files, process.env.GITHUB_SHA ?? "dev");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(docsDir, distDir, { recursive: true, filter: (path) => !basename(path).startsWith(".") });
await cp(dataDir, join(distDir, "v1"), {
  recursive: true,
  filter: (path) => !basename(path).startsWith("."),
});
await mkdir(join(distDir, "fonts"), { recursive: true });
for (const file of FONT_FILES) {
  const source = fileURLToPath(
    import.meta.resolve(`@fontsource-variable/jetbrains-mono/files/${file}`),
  );
  await cp(source, join(distDir, "fonts", file));
}
for (const [path, text] of site.files) {
  const target = join(distDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}
await rm(dirname(workerFile), { recursive: true, force: true });
const workerBytes = await bundleWorker(join(appDir, "src", "worker.ts"), workerFile, site.build);

const sizes = new Map<string, number>();
for (const entry of await readdir(distDir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  sizes.set(relative(distDir, path).split(sep).join("/"), (await stat(path)).size);
}
const problems = checkDist(sizes, site.openapi, site.data.dataset);
if (problems.length > 0) {
  fail(problems);
}

const totalBytes = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
console.log(
  `build ok · ${sizes.size} files · ${(totalBytes / 1024 / 1024).toFixed(1)} MB · ` +
    `worker.js ${(workerBytes / 1024).toFixed(0)} KB · ${site.build.dataVersion} · ${relative(rootDir, distDir)}`,
);
