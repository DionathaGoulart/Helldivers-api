import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { jsonSchemaFiles } from "../src/json-schema.ts";

// Usage: pnpm schemas:export [dir]   (default data/v1/schemas)
// Writes one JSON Schema per entity and envelope from the zod schemas (arch §8.2).
const cwd = process.env.INIT_CWD ?? process.cwd();
const outDir = resolve(cwd, process.argv[2] ?? "data/v1/schemas");
const shownDir = relative(cwd, outDir);

const files = jsonSchemaFiles();
await mkdir(outDir, { recursive: true });
for (const [name, text] of files) {
  await writeFile(join(outDir, name), text);
}

const shown = shownDir.startsWith("..") ? outDir : shownDir || ".";
console.log(`schemas:export ok · ${files.size} files · ${shown}`);
