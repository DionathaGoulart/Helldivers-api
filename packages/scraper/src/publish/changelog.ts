import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Change, ChangelogEntry } from "@hd2/schemas";
import { z } from "zod";
import { writeJson } from "./write.ts";

// `data/v1/changelog.json` keeps the newest 90 entries; older ones move to
// `data/changelog/<year>.json` (arch §6.6).

export const MAX_CHANGELOG_ENTRIES = 90;

const ChangelogArchive = z.array(ChangelogEntry);

export function buildEntry(
  dataVersion: string,
  date: string,
  changes: readonly Change[],
): ChangelogEntry {
  const count = (kind: Change["kind"]) => changes.filter((change) => change.kind === kind).length;
  return ChangelogEntry.parse({
    dataVersion,
    date,
    summary: { added: count("added"), changed: count("changed"), removed: count("removed") },
    changes,
  });
}

export function prependEntry(
  entries: readonly ChangelogEntry[],
  entry: ChangelogEntry,
): { kept: ChangelogEntry[]; archived: ChangelogEntry[] } {
  const all = [entry, ...entries];
  return { kept: all.slice(0, MAX_CHANGELOG_ENTRIES), archived: all.slice(MAX_CHANGELOG_ENTRIES) };
}

/** Appends entries that left `changelog.json` to their year file, newest first. */
export async function archiveEntries(
  dataDir: string,
  archived: readonly ChangelogEntry[],
): Promise<void> {
  const byYear = Map.groupBy(archived, (entry) => entry.date.slice(0, 4));
  for (const [year, entries] of byYear) {
    const path = join(dataDir, "changelog", `${year}.json`);
    let existing: ChangelogEntry[] = [];
    try {
      existing = ChangelogArchive.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const seen = new Set(existing.map((entry) => entry.dataVersion));
    const merged = [...entries.filter((entry) => !seen.has(entry.dataVersion)), ...existing].sort(
      (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
    );
    await mkdir(join(dataDir, "changelog"), { recursive: true });
    await writeFile(path, writeJson(merged));
  }
}
