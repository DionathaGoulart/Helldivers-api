import { relative, resolve } from "node:path";
import { validateDataset } from "../src/dataset.ts";
import { readDatasetFiles } from "../src/node.ts";

// Usage: pnpm validate:data [dir]   (default data/v1)
// Exit 1 on any schema, file-layout or integrity issue, one line per issue.
const cwd = process.env.INIT_CWD ?? process.cwd();
const dir = resolve(cwd, process.argv[2] ?? "data/v1");
const relativeDir = relative(cwd, dir);
const shown = relativeDir.startsWith("..") ? dir : relativeDir || ".";

try {
  const { files, issues: readIssues } = await readDatasetFiles(dir);
  const issues = [...readIssues, ...validateDataset(files)];
  if (issues.length === 0) {
    console.log(`validate:data ok · ${files.size} files · ${shown}`);
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
