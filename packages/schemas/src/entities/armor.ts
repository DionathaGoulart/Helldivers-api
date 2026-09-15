import { z } from "zod";
import { Base, Id, Source, WikiRef } from "../common.ts";

export const Armor = z.object({
  ...Base,
  weight: z.enum(["light", "medium", "heavy"]),
  armorRating: z.number().int().nonnegative(),
  speed: z.number().int().nonnegative(),
  staminaRegen: z.number().int().nonnegative(),
  passiveId: Id,
  setIds: z.array(Id).min(1),
  source: Source,
});

// Helmets and capes carry no stats: the wiki marks them "standard issue".
export const Helmet = z.object({ ...Base, setIds: z.array(Id), source: Source });

export const Cape = z.object({
  ...Base,
  setIds: z.array(Id),
  playerCardId: Id.nullable(), // same wiki page, DRUID tab "Player Card"
  source: Source,
});

export const ArmorSet = z.object({
  id: Id,
  slug: Id,
  name: z.string().min(1),
  wiki: WikiRef,
  armorId: Id,
  helmetId: Id,
  capeId: Id.nullable(),
  capeLink: z
    .object({
      method: z.enum(["superstore_set", "warbond_page", "override"]),
      evidence: z.string(),
    })
    .nullable(),
});

export type Armor = z.infer<typeof Armor>;
export type Helmet = z.infer<typeof Helmet>;
export type Cape = z.infer<typeof Cape>;
export type ArmorSet = z.infer<typeof ArmorSet>;
