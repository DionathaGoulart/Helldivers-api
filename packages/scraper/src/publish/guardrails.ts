import type { Collection } from "@hd2/schemas";

// Count and coverage guardrails (arch §7.1). Any issue is fatal: nothing is published.

export const COUNT_DROP_RATIO = 0.9;

export type GuardrailCheck = "empty" | "count-drop" | "index-coverage";

export interface GuardrailIssue {
  check: GuardrailCheck;
  collection: Collection;
  message: string;
}

export interface CollectionCounts {
  collection: Collection;
  count: number; // entities produced by this run
  indexCount: number; // rows on the index page(s)
  previous: number; // entities in the current dataset (0 before the first publish)
}

export interface GuardrailOptions {
  /** Accept a drop above 10 % (the wiki really removed items). An empty collection still fails. */
  allowDrop: boolean;
}

const percent = (value: number) => `${(value * 100).toFixed(1)} %`;

export function checkGuardrails(
  counts: readonly CollectionCounts[],
  options: GuardrailOptions,
): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  for (const { collection, count, indexCount, previous } of counts) {
    if (count === 0) {
      issues.push({ check: "empty", collection, message: `${collection}: no entities` });
      continue;
    }
    if (!options.allowDrop && count < previous * COUNT_DROP_RATIO) {
      issues.push({
        check: "count-drop",
        collection,
        message: `${collection}: ${previous} → ${count} (-${percent((previous - count) / previous)}, limit ${percent(1 - COUNT_DROP_RATIO)}); rerun with --allow-drop if the wiki removed them`,
      });
    }
    if (count !== indexCount) {
      issues.push({
        check: "index-coverage",
        collection,
        message: `${collection}: ${count} entities for ${indexCount} index rows`,
      });
    }
  }
  return issues;
}
