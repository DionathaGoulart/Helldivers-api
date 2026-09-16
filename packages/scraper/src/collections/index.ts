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
import { warbondsPipeline } from "./warbonds.ts";
import { weaponTraitsPipeline } from "./weapon-traits.ts";
import { weaponsPipeline } from "./weapons.ts";

// Collections scraped so far (plan §4–§5); a full run runs all of them in this order.
// Reference collections come before the entities that resolve against them (weapon traits
// before weapons and stratagems, passives before armors), armor sets come after the armors and
// helmets they are built from, player cards after the capes they pair with, and warbonds after
// every item collection their page tables refer to.
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
  warbondsPipeline,
];

/** The pipelines of `only`, in run order (dependencies first), or all of them. */
export function selectPipelines(only: readonly Collection[] | null): CollectionPipeline[] {
  if (only === null) {
    return [...PIPELINES];
  }
  for (const collection of only) {
    if (!PIPELINES.some((candidate) => candidate.collection === collection)) {
      const available = PIPELINES.map((candidate) => candidate.collection).join(", ");
      throw new Error(`${collection} is not scraped yet (available: ${available})`);
    }
  }
  return PIPELINES.filter((pipeline) => only.includes(pipeline.collection));
}
