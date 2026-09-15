import { z } from "zod";
import { Base, Id, Penetration, Source } from "../common.ts";

export const FiringMode = z.enum(["auto", "semi", "burst", "volley", "charge", "other"]);

export const Attack = z.object({
  name: z.string(), // "5.5x50mm FULL METAL JACKET P"
  kind: z.enum(["projectile", "explosion", "beam", "arc", "melee", "other"]),
  damage: z.object({
    standard: z.number().nullable(),
    durable: z.number().nullable(),
    type: z.string().nullable(), // "Ballistic", "Explosion", "Laser"
  }),
  penetration: z.object({
    direct: Penetration.nullable(),
    slightAngle: Penetration.nullable(),
    largeAngle: Penetration.nullable(),
    extremeAngle: Penetration.nullable(),
  }),
  projectile: z
    .object({
      pellets: z.number().int().positive().nullable(), // SG-88: 9
      massG: z.number().nullable(),
      initialVelocityMps: z.number().nullable(),
      dragFactorPct: z.number().nullable(),
      gravityFactorPct: z.number().nullable(),
      penetrationSlowdownPct: z.number().nullable(),
    })
    .nullable(),
  area: z
    .object({
      innerRadiusM: z.number().nullable(),
      outerRadiusM: z.number().nullable(),
      shockwaveRadiusM: z.number().nullable(),
    })
    .nullable(),
  forces: z.object({
    demolition: z.number().nullable(),
    stagger: z.number().nullable(),
    push: z.number().nullable(),
  }),
});

export const FirearmStats = z.object({
  firingModes: z.array(FiringMode),
  fireRateRpm: z.array(z.number().positive()), // MG-43: [630, 760, 900]
  dps: z.array(z.number().nonnegative()),
  capacity: z.number().int().nullable(),
  // Rounds-reload weapons count rounds in the four fields below (arch §5.4).
  spareMagazines: z.number().int().nullable(),
  startingMagazines: z.number().int().nullable(),
  magazinesFromSupply: z.number().int().nullable(),
  magazinesFromAmmoBox: z.number().int().nullable(),
  recoil: z.number().nullable(),
  horizontalRecoil: z.number().nullable(),
  verticalRecoil: z.number().nullable(),
  spread: z.object({ horizontal: z.number(), vertical: z.number() }).nullable(),
  sway: z.number().nullable(),
  ergonomics: z.number().nullable(),
  reloadKind: z.enum(["magazine", "rounds", "stationary", "none"]),
  reloadTimeS: z.number().nullable(),
  reloadTimeUpgradedS: z.number().nullable(),
  tacticalReloadTimeS: z.number().nullable(),
});

export const ThrowableStats = z.object({
  capacity: z.number().int().nullable(),
  startingCount: z.number().int().nullable(),
  fromSupply: z.number().int().nullable(),
  fuseTimeS: z.number().nullable(),
  cookable: z.boolean().nullable(),
});

export const Weapon = z.object({
  ...Base,
  category: z.enum(["primary", "secondary", "throwable", "civilian"]), // civilian = field pickups
  subcategory: z.enum([
    "assault_rifle",
    "marksman_rifle",
    "submachine_gun",
    "shotgun",
    "explosive",
    "energy_based",
    "special",
    "pistol",
    "melee",
    "standard",
  ]),
  traitIds: z.array(Id),
  firearm: FirearmStats.nullable(), // null for melee and throwables
  throwable: ThrowableStats.nullable(), // null unless category = throwable
  attacks: z.array(Attack),
  statsRaw: z.record(z.string(), z.string()),
  source: Source,
});

export type FiringMode = z.infer<typeof FiringMode>;
export type Attack = z.infer<typeof Attack>;
export type FirearmStats = z.infer<typeof FirearmStats>;
export type ThrowableStats = z.infer<typeof ThrowableStats>;
export type Weapon = z.infer<typeof Weapon>;
