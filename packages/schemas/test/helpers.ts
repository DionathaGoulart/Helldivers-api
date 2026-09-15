export type PathSegment = string | number;

export const DELETE = Symbol("delete");

/** Returns a copy of `value` with `path` replaced by `next`, or removed with `DELETE`. */
export function mutate(value: unknown, path: readonly PathSegment[], next: unknown): unknown {
  const copy = structuredClone(value);
  let node: unknown = copy;
  for (const segment of path.slice(0, -1)) {
    node = (node as Record<PathSegment, unknown>)[segment];
  }
  const parent = node as Record<PathSegment, unknown>;
  const last = path.at(-1) ?? "";
  if (next === DELETE) {
    delete parent[last];
  } else {
    parent[last] = next;
  }
  return copy;
}
