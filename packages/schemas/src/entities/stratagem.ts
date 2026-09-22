import { z } from "zod";
import { Base, Department, Id, Penetration, Source, StatsRaw } from "../common.ts";
import { Attack, FirearmStats } from "./weapon.ts";

export const Direction = z.enum(["up", "down", "left", "right"]);

export const Stratagem = z
  .object({
    ...Base,
    permitType: z.enum(["offensive", "supply", "defensive", "mission"]),
    availability: z.enum(["loadout", "mission", "objective", "unavailable"]),
    category: Department.nullable(), // null when the wiki gives a warbond/event instead
    // From "<Kind> Stratagems" page categories; confirmed against #catlinks in Phase 3c.
    kind: z.enum([
      "orbital",
      "eagle",
      "support_weapon",
      "backpack",
      "sentry",
      "emplacement",
      "mine",
      "vehicle",
      "mission",
      "other",
    ]),
    traitIds: z.array(Id),
    code: z.array(Direction), // empty only while upcoming and the code is unknown
    cooldownS: z.number().nonnegative().nullable(),
    cooldownVariants: z.array(z.object({ label: z.string(), seconds: z.number().nonnegative() })),
    callInTimeS: z.number().nonnegative().nullable(),
    callInTimeUpgradedS: z.number().nonnegative().nullable(),
    uses: z.union([z.number().int().positive(), z.literal("unlimited")]).nullable(),
    unlockLevel: z.number().int().positive().nullable(),
    shipModules: z.array(
      z.object({ department: Department, module: z.string(), effect: z.string() }),
    ),
    supportWeapon: FirearmStats.nullable(), // stats when the stratagem calls a weapon
    backpack: z
      .object({
        health: z.number().nullable(),
        armor: Penetration.nullable(),
        capacity: z.number().int().nullable(),
      })
      .nullable(),
    attacks: z.array(Attack),
    statsRaw: StatsRaw,
    source: Source,
  })
  .refine((stratagem) => stratagem.upcoming || stratagem.code.length > 0, {
    message: "a released stratagem needs a code",
    path: ["code"],
  });

export type Direction = z.infer<typeof Direction>;
export type Stratagem = z.infer<typeof Stratagem>;
