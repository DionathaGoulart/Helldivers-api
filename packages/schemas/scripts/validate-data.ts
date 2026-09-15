import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { Id } from "../src/common.ts";
import { validateDataset } from "../src/dataset.ts";
import { readDatasetFiles } from "../src/node.ts";

// Usage: pnpm validate:data [dir]   (default data/v1)
// Exit 1 on any schema, file-layout or integrity issue, one line per issue.
const cwd = process.env.INIT_CWD ?? process.cwd();
const dir = resolve(cwd, process.argv[2] ?? "data/v1");
const relativeDir = relative(cwd, dir);
const shown = relativeDir.startsWith("..") ? dir : relativeDir || ".";

// Temporary (plan §4): warbond ids that boosters reference before the warbonds
// collection is scraped. `<dir>/../overrides/warbond-stubs.json`, removed in Phase 3f.
async function readWarbondStubs(): Promise<Set<string> | null> {
  const file = join(dirname(dir), "overrides", "warbond-stubs.json");
  if (!existsSync(file)) {
    return null;
  }
  return new Set(z.array(Id).parse(JSON.parse(await readFile(file, "utf8"))));
}

try {
  const { files, issues: readIssues } = await readDatasetFiles(dir);
  const stubs = await readWarbondStubs();
  const issues = [
    ...readIssues,
    ...validateDataset(files, stubs ? { knownIds: { warbonds: stubs } } : {}),
  ];
  if (issues.length === 0) {
    const note = stubs && !files.has("warbonds.json") ? ` · ${stubs.size} warbond stubs` : "";
    console.log(`validate:data ok · ${files.size} files · ${shown}${note}`);
  } else {
    for (const issue of issues) {
      console.error(
        `${shown}/${issue.file}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
      );
    }
    console.error(`validate:data: ${issues.length} issue(s) in ${shown}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`validate:data: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
