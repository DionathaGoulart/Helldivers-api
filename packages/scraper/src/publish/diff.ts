import { type Change, Collection, type Dataset, formatPath } from "@hd2/schemas";

// Deep diff per entity id (arch §6.6).

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const IMAGE_HASH = /\.[a-f0-9]{8}\.webp$/;

// A re-encoded image with the same wiki file only changes the hash in its key.
function sameImageExceptHash(before: unknown, after: unknown): boolean {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return false;
  }
  const { url: beforeUrl, ...beforeRest } = before;
  const { url: afterUrl, ...afterRest } = after;
  return (
    typeof beforeUrl === "string" &&
    typeof afterUrl === "string" &&
    beforeUrl.replace(IMAGE_HASH, "") === afterUrl.replace(IMAGE_HASH, "") &&
    JSON.stringify(beforeRest) === JSON.stringify(afterRest)
  );
}

/** JSON paths that differ (`source.cost.amount`); an array that changed length is one path. */
export function diffPaths(before: unknown, after: unknown, path: PropertyKey[] = []): string[] {
  if (path.at(-1) === "image" && sameImageExceptHash(before, after)) {
    return [];
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, i) => diffPaths(item, after[i], [...path, i]));
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) =>
      key in before && key in after
        ? diffPaths(before[key], after[key], [...path, key])
        : [formatPath([...path, key])],
    );
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [formatPath(path)];
}

/** Changes between two datasets; a collection missing from `after` is left out. */
export function diffDatasets(before: Dataset, after: Dataset): Change[] {
  const changes: Change[] = [];
  for (const collection of Collection.options) {
    const next = after[collection];
    if (!next) {
      continue;
    }
    const previous = new Map<string, unknown>((before[collection] ?? []).map((e) => [e.id, e]));
    const current = new Map<string, unknown>(next.map((entity) => [entity.id, entity]));
    const ids = [...new Set([...previous.keys(), ...current.keys()])].sort();
    for (const id of ids) {
      if (!previous.has(id)) {
        changes.push({ collection, id, kind: "added" });
      } else if (!current.has(id)) {
        changes.push({ collection, id, kind: "removed" });
      } else {
        const paths = diffPaths(previous.get(id), current.get(id));
        if (paths.length > 0) {
          changes.push({ collection, id, kind: "changed", paths });
        }
      }
    }
  }
  return changes;
}
