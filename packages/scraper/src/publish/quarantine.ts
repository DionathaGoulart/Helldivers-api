import {
  type Collection,
  checkIntegrity,
  type Dataset,
  type Id,
  type IntegrityIssue,
} from "@hd2/schemas";

// Quarantine (arch §6.1 step 8a): entities the wiki contradicts itself about are held at their
// published version, or held back when new, so the rest of the run still publishes. Integrity
// issues are cross-page contradictions; a broken parser shows up as a parse or schema error, or
// as more quarantined entities than MAX_QUARANTINED, and still fails the run.

export const MAX_QUARANTINED = 10;

export interface QuarantinedEntity {
  collection: Collection;
  id: Id;
  action: "kept-published" | "held-back"; // published version kept, or a new entity left out
  reasons: string[]; // integrity messages, "source.page: warbonds/x page 3 does not list …"
}

export interface QuarantineResult {
  dataset: Dataset;
  quarantined: QuarantinedEntity[];
  issues: IntegrityIssue[]; // left over: over the limit, or not fixed by the published versions
}

type Entity = { id: Id };

const keyOf = (collection: Collection, id: Id) => `${collection}/${id}`;

/**
 * Replaces each entity with an integrity issue by its published version, or drops it when it has
 * none, and checks again, since the published version may disagree with fresh neighbours in turn.
 * Stops when the dataset is sound, when nothing is left to replace, or past `limit` entities.
 */
export function quarantine(
  dataset: Dataset,
  published: Dataset,
  limit = MAX_QUARANTINED,
): QuarantineResult {
  let next = dataset;
  const quarantined = new Map<string, QuarantinedEntity>();
  for (;;) {
    const issues = checkIntegrity(next);
    const offenders = new Map<string, IntegrityIssue[]>();
    for (const issue of issues) {
      const key = keyOf(issue.collection, issue.id);
      if (!quarantined.has(key)) {
        offenders.set(key, [...(offenders.get(key) ?? []), issue]);
      }
    }
    if (offenders.size === 0 || quarantined.size + offenders.size > limit) {
      return { dataset: next, quarantined: [...quarantined.values()], issues };
    }

    const replaced: Record<string, unknown> = { ...next };
    for (const [key, found] of offenders) {
      const [first] = found;
      if (!first) continue;
      const { collection, id } = first;
      const old = (published[collection] as readonly Entity[] | undefined)?.find(
        (entity) => entity.id === id,
      );
      const current = (replaced[collection] ?? []) as readonly Entity[];
      replaced[collection] = old
        ? current.map((entity) => (entity.id === id ? old : entity))
        : current.filter((entity) => entity.id !== id);
      quarantined.set(key, {
        collection,
        id,
        action: old ? "kept-published" : "held-back",
        reasons: found.map((issue) => `${issue.field}: ${issue.message}`),
      });
    }
    next = replaced as Dataset;
  }
}
