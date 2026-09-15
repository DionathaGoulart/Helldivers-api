import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { DatasetIssue } from "./dataset.ts";
import { IdLock } from "./slug.ts";

// Node-only helpers (`@hd2/schemas/node`); the main entry stays runtime-agnostic
// so the API Functions can import it.

export interface DatasetFiles {
  files: Map<string, unknown>; // relative POSIX path → parsed JSON
  issues: DatasetIssue[]; // files that are not JSON or do not parse
}

/** Reads a `data/v1` tree for `validateDataset`; dotfiles (e.g. `.DS_Store`) are skipped. */
export async function readDatasetFiles(dir: string): Promise<DatasetFiles> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();

  const files = new Map<string, unknown>();
  const issues: DatasetIssue[] = [];
  for (const file of paths) {
    if (!file.endsWith(".json")) {
      issues.push({ file, path: "", message: "unexpected file" });
      continue;
    }
    try {
      files.set(file, JSON.parse(await readFile(join(dir, file), "utf8")));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({ file, path: "", message: `invalid JSON: ${reason}` });
    }
  }
  return { files, issues };
}

/** Reads `ids.lock.json`; a missing file is an empty lock (first publish). */
export async function readIdLock(path: string): Promise<IdLock> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return IdLock.from({});
    }
    throw error;
  }
  return IdLock.from(JSON.parse(text));
}

/** Writes `ids.lock.json` through a temporary file so a crash never truncates it. */
export async function writeIdLock(path: string, lock: IdLock): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, lock.serialize());
  await rename(temporary, path);
}
