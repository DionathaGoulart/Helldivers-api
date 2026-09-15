import type { z } from "zod";
import type { Collection } from "./common.ts";
import { Armor, ArmorSet, Cape, Helmet } from "./entities/armor.ts";
import { Booster } from "./entities/booster.ts";
import { Emote, Pattern, PlayerCard, Title } from "./entities/cosmetics.ts";
import { Passive, WeaponTrait } from "./entities/reference.ts";
import { Stratagem } from "./entities/stratagem.ts";
import { Warbond } from "./entities/warbond.ts";
import { Weapon } from "./entities/weapon.ts";

/** Entity schema of each collection. */
export const collectionSchemas = {
  warbonds: Warbond,
  weapons: Weapon,
  stratagems: Stratagem,
  armors: Armor,
  helmets: Helmet,
  capes: Cape,
  "armor-sets": ArmorSet,
  boosters: Booster,
  passives: Passive,
  "weapon-traits": WeaponTrait,
  "player-cards": PlayerCard,
  emotes: Emote,
  patterns: Pattern,
  titles: Title,
} as const satisfies Record<Collection, z.ZodType>;

/** Singular entity name of each collection, used for `/v1/schemas/<entity>.json`. */
export const entityNames = {
  warbonds: "warbond",
  weapons: "weapon",
  stratagems: "stratagem",
  armors: "armor",
  helmets: "helmet",
  capes: "cape",
  "armor-sets": "armor-set",
  boosters: "booster",
  passives: "passive",
  "weapon-traits": "weapon-trait",
  "player-cards": "player-card",
  emotes: "emote",
  patterns: "pattern",
  titles: "title",
} as const satisfies Record<Collection, string>;

export type CollectionEntity<C extends Collection> = z.infer<(typeof collectionSchemas)[C]>;
