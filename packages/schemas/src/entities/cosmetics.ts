import { z } from "zod";
import { Base, Id, Image, Source } from "../common.ts";

export const PlayerCard = z.object({
  ...Base,
  pairedCapeId: Id.nullable(), // null for standalone cards (e.g. Solid Black)
  source: Source,
});

export const Emote = z
  .object({
    ...Base,
    emote: z.boolean(), // Cosmetics table "Emote" ✅/❌
    victoryPose: z.boolean(), // Cosmetics table "Victory Pose" ✅/❌
    source: Source,
  })
  .refine((emote) => emote.emote || emote.victoryPose, "at least one flag");

export const PatternTarget = z.enum(["shuttle", "hellpod", "exosuit", "vehicle", "weapon"]);

export const Pattern = z.object({
  ...Base, // image = first variant icon
  scope: z.enum(["vehicle", "weapon"]),
  unlockLevel: z.number().int().nonnegative().nullable(), // weapon patterns only ("Level Needed")
  variants: z
    .array(
      z.object({
        target: PatternTarget, // vehicle scope: shuttle|hellpod|exosuit|vehicle; weapon scope: weapon
        image: Image.nullable(),
        source: Source,
      }),
    )
    .min(1),
});

export const Title = z.object({
  ...Base,
  kind: z.enum(["rank", "acquirable"]),
  levelEarned: z.number().int().positive().nullable(), // rank titles only
  source: Source, // rank: { type: "progression", cost: null }
});

export type PlayerCard = z.infer<typeof PlayerCard>;
export type Emote = z.infer<typeof Emote>;
export type PatternTarget = z.infer<typeof PatternTarget>;
export type Pattern = z.infer<typeof Pattern>;
export type Title = z.infer<typeof Title>;
