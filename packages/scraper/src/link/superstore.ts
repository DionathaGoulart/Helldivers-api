import type { Collection, Dataset } from "@hd2/schemas";
import type { RawSuperstore } from "../parsers/superstore.ts";

// Rule 5 (arch §5.5): every Superstore stock item is an entity sourced from the Superstore at
// the stock price, and every entity sourced from the Superstore is in stock. Item pages already
// say so (109 of 109 on 2026-09-16), so a difference is a warning, not a correction.

const STORE_TYPES: Readonly<Record<string, readonly Collection[]>> = {
  Armor: ["armors"],
  Helmet: ["helmets"],
  Cape: ["capes"],
  "Player Card": ["player-cards"],
  PlayerCard: ["player-cards"],
  Emote: ["emotes"],
};
const UNTYPED: readonly Collection[] = ["weapons", "stratagems", "emotes"]; // "SG-97 Sweeper (400 SC)"

const STORE_COLLECTIONS = [
  "weapons",
  "stratagems",
  "armors",
  "helmets",
  "capes",
  "player-cards",
  "emotes",
] as const satisfies readonly Collection[];

export function checkSuperstoreSources(dataset: Dataset, superstore: RawSuperstore): string[] {
  const warnings: string[] = [];
  const entities = STORE_COLLECTIONS.flatMap((collection) =>
    (dataset[collection] ?? []).map((entity) => ({
      collection,
      id: entity.id,
      title: entity.wiki.title,
      source: entity.source,
    })),
  );
  const stocked = new Set<string>();

  for (const page of superstore.pages) {
    for (const item of page.items) {
      const what = `Superstore page ${page.number} "${item.name}"${item.type ? ` (${item.type})` : ""}`;
      const collections = item.type === null ? UNTYPED : STORE_TYPES[item.type];
      if (!collections) {
        warnings.push(`${what}: unknown item type`);
        continue;
      }
      const found = entities.filter(
        (entity) => collections.includes(entity.collection) && entity.title === item.link.title,
      );
      const [entity, ...others] = found;
      if (!entity || others.length > 0) {
        if (collections.some((collection) => dataset[collection])) {
          warnings.push(`${what}: matches ${found.length} entities`);
        }
        continue;
      }
      const key = `${entity.collection}/${entity.id}`;
      stocked.add(key);
      const price = Number(item.cost.text.replaceAll(",", ""));
      const { source } = entity;
      if (
        source.type !== "superstore" ||
        source.cost?.currency !== "super_credits" ||
        source.cost.amount !== price ||
        item.cost.currency !== "super_credits"
      ) {
        const cost = source.cost ? `${source.cost.amount} ${source.cost.currency}` : "no cost";
        warnings.push(
          `${key}: ${what} sells it for ${item.cost.text} SC, source says ${source.type} (${cost})`,
        );
      }
    }
  }

  for (const entity of entities) {
    const key = `${entity.collection}/${entity.id}`;
    if (entity.source.type === "superstore" && !stocked.has(key)) {
      warnings.push(`${key}: sourced from the Superstore but not in its stock`);
    }
  }
  return warnings;
}
