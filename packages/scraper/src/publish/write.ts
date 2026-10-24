import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

// Stage then swap (arch §6.1 steps 9 and 11): `data/v1` is replaced only as a whole.

/** Pretty JSON with a trailing newline; key order is whatever the value already has. */
export const writeJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** `.staging/` next to the data directory, so the final rename stays on one filesystem. */
export const stagingDir = (dataDir: string) =>
  join(dirname(resolve(dataDir)), `.staging-${basename(resolve(dataDir))}`);

/** Recover an interrupted swap before reading any published data or the ID lock. */
export async function recoverDataset(dataDir: string): Promise<void> {
  const previous = join(stagingDir(dataDir), "data.previous");
  if (!existsSync(dataDir) && existsSync(previous)) {
    await rename(previous, dataDir);
  }
}

export async function writeDataset(
  dataDir: string,
  files: ReadonlyMap<string, unknown>,
  prepare?: (stagedDataDir: string) => Promise<void>,
): Promise<void> {
  const staging = stagingDir(dataDir);
  const staged = join(staging, "data");
  const previous = join(staging, "data.previous");
  const target = resolve(dataDir);

  await recoverDataset(target);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  // Include overrides, the ID lock and archives in the same recoverable publication.
  if (existsSync(target)) await cp(target, staged, { recursive: true });
  await rm(join(staged, "v1"), { recursive: true, force: true });
  for (const [path, value] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const file = join(staged, "v1", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, writeJson(value));
  }

  await prepare?.(staged);
  if (existsSync(target)) {
    await rename(target, previous);
  }
  try {
    await rename(staged, target);
  } catch (error) {
    // If recovery also fails, preserve the backup for the next run/operator.
    await recoverDataset(target);
    throw error;
  }
  // Publication is complete. Cleanup failure must not turn a committed swap into a failure.
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}
