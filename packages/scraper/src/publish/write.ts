import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Stage then swap (arch §6.1 steps 9 and 11): `data/v1` is replaced only as a whole.

/** Pretty JSON with a trailing newline; key order is whatever the value already has. */
export const writeJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** `.staging/` next to the data directory, so the final rename stays on one filesystem. */
export const stagingDir = (dataDir: string) => join(dirname(resolve(dataDir)), ".staging");

export async function writeDataset(
  dataDir: string,
  files: ReadonlyMap<string, unknown>,
): Promise<void> {
  const staging = stagingDir(dataDir);
  const staged = join(staging, "v1");
  const previous = join(staging, "v1.previous");
  const target = join(dataDir, "v1");

  await rm(staging, { recursive: true, force: true });
  for (const [path, value] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const file = join(staged, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, writeJson(value));
  }

  await mkdir(dataDir, { recursive: true });
  if (existsSync(target)) {
    await rename(target, previous);
  }
  await rename(staged, target);
  await rm(staging, { recursive: true, force: true });
}
