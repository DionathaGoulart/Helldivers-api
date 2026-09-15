import { z } from "zod";
import { Base, Collection, Cost, Id } from "../common.ts";
import { PatternTarget } from "./cosmetics.ts";

export const WarbondRefCollection = Collection.extract([
  "weapons",
  "stratagems",
  "armors",
  "helmets",
  "capes",
  "boosters",
  "player-cards",
  "emotes",
  "patterns",
  "titles",
]);

export const WarbondItem = z.object({
  name: z.string(), // as listed on the warbond page
  wikiType: z.string(), // "Medium Armor", "Player Card", "Pattern"
  ref: z
    .object({
      collection: WarbondRefCollection,
      id: Id,
      variant: PatternTarget.nullable(), // patterns only
    })
    .nullable(), // null = currency rows ("100 Super Credits")
  cost: Cost, // medals; resolved value (arch §5.5)
});

export const Warbond = z.object({
  ...Base,
  type: z.enum(["standard", "premium", "legendary"]),
  releaseDate: z.iso.date(),
  cost: Cost, // super_credits; 0 for standard
  superCreditsClaimable: z.number().int().nonnegative(),
  medalsAllPages: z.number().int().nonnegative(),
  medalsAllItems: z.number().int().nonnegative(),
  pages: z
    .array(
      z.object({
        number: z.number().int().positive(),
        items: z.array(WarbondItem).min(1),
      }),
    )
    .min(1),
});

export type WarbondRefCollection = z.infer<typeof WarbondRefCollection>;
export type WarbondItem = z.infer<typeof WarbondItem>;
export type Warbond = z.infer<typeof Warbond>;
