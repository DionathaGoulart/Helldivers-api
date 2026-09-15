import { readFile, rename, writeFile } from "node:fs/promises";
import { IdLock } from "./slug.ts";

// Node-only helpers (`@hd2/schemas/node`); the main entry stays runtime-agnostic
// so the API Functions can import it.

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
