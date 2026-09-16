import type { Collection } from "@hd2/schemas";
import { armorSetsPipeline } from "./armor-sets.ts";
import { armorsPipeline } from "./armors.ts";
import { boostersPipeline } from "./boosters.ts";
import { capesPipeline } from "./capes.ts";
import { emotesPipeline } from "./emotes.ts";
import { helmetsPipeline } from "./helmets.ts";
import { passivesPipeline } from "./passives.ts";
import { patternsPipeline } from "./patterns.ts";
import { playerCardsPipeline } from "./player-cards.ts";
import { stratagemsPipeline } from "./stratagems.ts";
import { titlesPipeline } from "./titles.ts";
import type { CollectionPipeline } from "./types.ts";
import { weaponTraitsPipeline } from "./weapon-traits.ts";
import { weaponsPipeline } from "./weapons.ts";

// Collections scraped so far (plan §4–§5); a full run runs all of them in this order.
// Reference collections come before the entities that resolve against them (weapon traits
// before weapons and stratagems, passives before armors), armor sets come after the armors and
// helmets they are built from, and player cards after the capes they pair with.
export const PIPELINES: readonly CollectionPipeline[] = [
  boostersPipeline,
  passivesPipeline,
  weaponTraitsPipeline,
  weaponsPipeline,
  stratagemsPipeline,
  armorsPipeline,
  helmetsPipeline,
  capesPipeline,
  armorSetsPipeline,
  playerCardsPipeline,
  emotesPipeline,
  patternsPipeline,
  titlesPipeline,
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
