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
  cost: Cost.nullable(), // medals; resolved value (arch §5.5); null = not announced yet
});

export const Warbond = z
  .object({
    ...Base,
    type: z.enum(["standard", "premium", "legendary"]),
    releaseDate: z.iso.date(),
    cost: Cost.nullable(), // super_credits; 0 for standard, null if upcoming price is unannounced
    superCreditsClaimable: z.number().int().nonnegative().nullable(), // null if upcoming amount is unannounced; "None" = 0
    medalsAllPages: z.number().int().nonnegative().nullable(), // null = not announced yet
    medalsAllItems: z.number().int().nonnegative().nullable(),
    pages: z
      .array(
        z.object({
          number: z.number().int().positive(),
          items: z.array(WarbondItem).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((warbond, context) => {
    if (warbond.upcoming) return;
    for (const field of ["cost", "superCreditsClaimable"] as const) {
      if (warbond[field] === null) {
        context.addIssue({ code: "custom", path: [field], message: "missing on released warbond" });
      }
    }
  });

export type WarbondRefCollection = z.infer<typeof WarbondRefCollection>;
export type WarbondItem = z.infer<typeof WarbondItem>;
export type Warbond = z.infer<typeof Warbond>;
