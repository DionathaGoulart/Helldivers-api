import { type Collection, type Conflict, ConflictReport } from "@hd2/schemas";

// `reports/conflicts.json` (arch §5.5): conflicts of the collections scraped in this run
// replace theirs; the others are carried over. Sorted by collection, id and field.

export const CONFLICTS_FILE = "reports/conflicts.json";

const key = (conflict: Conflict) => `${conflict.collection}\0${conflict.id}\0${conflict.field}`;

export function mergeConflicts(
  previous: unknown,
  scraped: readonly Collection[],
  fresh: readonly Conflict[],
): ConflictReport | null {
  const kept =
    previous === undefined
      ? []
      : ConflictReport.parse(previous).conflicts.filter((c) => !scraped.includes(c.collection));
  const conflicts = [...kept, ...fresh].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
  );
  return conflicts.length > 0 ? ConflictReport.parse({ conflicts }) : null;
}
