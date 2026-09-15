import type { Collection } from "@hd2/schemas";
import { boostersPipeline } from "./boosters.ts";
import { passivesPipeline } from "./passives.ts";
import type { CollectionPipeline } from "./types.ts";
import { weaponTraitsPipeline } from "./weapon-traits.ts";

// Collections scraped so far (plan §4–§5), in registry order; a full run runs all of them.
export const PIPELINES: readonly CollectionPipeline[] = [
  boostersPipeline,
  passivesPipeline,
  weaponTraitsPipeline,
];

export function selectPipelines(only: readonly Collection[] | null): CollectionPipeline[] {
  if (only === null) {
    return [...PIPELINES];
  }
  return only.map((collection) => {
    const pipeline = PIPELINES.find((candidate) => candidate.collection === collection);
    if (!pipeline) {
      const available = PIPELINES.map((candidate) => candidate.collection).join(", ");
      throw new Error(`${collection} is not scraped yet (available: ${available})`);
    }
    return pipeline;
  });
}
