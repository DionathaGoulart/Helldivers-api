import { z } from "zod";
import { Base, Id } from "../common.ts";

export const Passive = z.object({
  ...Base,
  effects: z.array(z.string()).min(1), // one entry per <br>-separated line
  armorIds: z.array(Id),
});

export const WeaponTrait = z.object({
  ...Base, // description null: the wiki has none
  weaponIds: z.array(Id),
  stratagemIds: z.array(Id),
});

export type Passive = z.infer<typeof Passive>;
export type WeaponTrait = z.infer<typeof WeaponTrait>;
