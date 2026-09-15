import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHeaders } from "./headers.ts";

// Phase 0 hello build: landing placeholder + `_headers`. The full static export
// (data tree, OpenAPI, `_routes.json`, Functions) replaces this in Phase 5.
const appDir = join(import.meta.dirname, "..");
const distDir = join(appDir, "dist");
const docsDir = join(appDir, "..", "docs");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyFile(join(docsDir, "index.html"), join(distDir, "index.html"));
await writeFile(join(distDir, "_headers"), renderHeaders());

console.log(`build ok · ${distDir}`);
