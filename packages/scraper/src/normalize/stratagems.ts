import {
  type Attack,
  Department,
  Direction,
  type FirearmStats,
  type Id,
  type Stratagem,
} from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import type { RawGeneralRow, RawStratagemPage } from "../parsers/stratagem-page.ts";
import type { PERMIT_HEADINGS, RawStratagemRow } from "../parsers/stratagems-index.ts";
import {
  firstSeconds,
  parseCount,
  parseDecimal,
  parsePenetration,
  parseSeconds,
  statValues,
} from "./stats.ts";
import {
  type Candidate,
  readAttacks,
  readFirearm,
  readStatsRaw,
  SEP,
  type StatConflict,
  StatReader,
} from "./weapons.ts";

// Stratagem index row + page → typed fields (arch §5.3 `Stratagem`). Permit and availability
// come from the index tables, kind from the page categories, stats from the infobox, the
// `General` table and the detailed tables with rule 2 (the most detailed value wins).

const PERMITS: Readonly<Record<(typeof PERMIT_HEADINGS)[number], Stratagem["permitType"]>> = {
  "Offensive Permit": "offensive",
  "Supply Permit": "supply",
  "Defensive Permit": "defensive",
  Other: "mission",
};

// Tables of the mission group, by the label above them.
const MISSION_TABLES: Readonly<Record<string, Stratagem["availability"]>> = {
  Ship: "mission",
  Objective: "objective",
  Unavailable: "unavailable",
};

export function permitAndAvailability(
  row: RawStratagemRow,
  page: string,
): Pick<Stratagem, "permitType" | "availability"> {
  const permitType = PERMITS[row.permit];
  if (permitType !== "mission") {
    return { permitType, availability: "loadout" };
  }
  const availability = row.label ? MISSION_TABLES[row.label] : undefined;
  if (!availability) {
    throw new NormalizeError(page, row.label ?? "", "unknown mission stratagem table");
  }
  return { permitType, availability };
}

// `<Kind> Stratagems` categories seen on 2026-09-16. Mines are "Emplacement Stratagems"; mission
// stratagems mix "Mission", "Objective", "Ship", "Other" and even "Eagle Stratagems" (Eagle
// Rearm), so every stratagem of the mission permit is `mission`.
const KIND_CATEGORIES: Readonly<Record<string, Stratagem["kind"]>> = {
  "Orbital Stratagems": "orbital",
  "Eagle Stratagems": "eagle",
  "Support Weapon Stratagems": "support_weapon",
  "Backpack Stratagems": "backpack",
  "Sentry Stratagems": "sentry",
  "Emplacement Stratagems": "emplacement",
  "Vehicle Stratagems": "vehicle",
  "Mission Stratagems": "mission",
};

export function kindFromCategories(
  categories: readonly string[],
  permitType: Stratagem["permitType"],
  page: string,
): Stratagem["kind"] {
  if (permitType === "mission") {
    return "mission";
  }
  const kinds = [...new Set(categories.flatMap((category) => KIND_CATEGORIES[category] ?? []))];
  const [kind] = kinds;
  if (kinds.length !== 1 || !kind) {
    throw new NormalizeError(
      page,
      categories.join(", "),
      `expected one stratagem kind category, found ${kinds.length}`,
    );
  }
  return kind;
}

/** Arrow names → directions: `Up` → `up`. */
export function parseCode(arrows: readonly string[], page: string): Direction[] {
  return arrows.map((arrow) => {
    const direction = Direction.safeParse(arrow.toLowerCase());
    if (!direction.success) {
      throw new NormalizeError(page, arrow, "unknown stratagem code arrow");
    }
    return direction.data;
  });
}

/** `Patriotic Administration Center` → `patriotic_administration_center` (ship section names). */
export function parseDepartment(label: string, page: string): Department {
  const department = Department.safeParse(label.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!department.success) {
    throw new NormalizeError(page, label, "unknown ship department");
  }
  return department.data;
}

/** `Unlimited`, `INF`, `∞` → `unlimited`; `3` → 3; `N/A` → null. */
export function parseUses(value: string, page: string): number | "unlimited" | null {
  if (/^(?:unlimited|inf|∞)$/i.test(value.trim())) {
    return "unlimited";
  }
  return parseCount(value, page);
}

/** `… Strike, abbreviated as OPS, …` and `… Grenade Launcher (BFGL) …` → ["OPS"], ["BFGL"]. */
export function leadAbbreviations(lead: string | null): string[] {
  const found = (lead ?? "").matchAll(
    /\babbreviated as ([A-Z][A-Z0-9]{1,5})\b|\(([A-Z][A-Z0-9]{1,5})\)/g,
  );
  return [...new Set([...found].map((match) => match[1] ?? match[2] ?? ""))].filter(Boolean);
}

export interface StratagemStats {
  cooldownS: number | null;
  cooldownVariants: Stratagem["cooldownVariants"];
  callInTimeS: number | null;
  callInTimeUpgradedS: number | null;
  uses: Stratagem["uses"];
  supportWeapon: FirearmStats | null;
  backpack: Stratagem["backpack"];
  attacks: Attack[];
  statsRaw: Record<string, string>;
  conflicts: StatConflict[];
}

export interface StratagemStatsOptions {
  page: string; // page URL, for errors
  kind: Stratagem["kind"];
  traitIds: readonly Id[];
}

const STANDARD = [null, "Standard"];

export function normalizeStratagemStats(
  raw: RawStratagemPage,
  options: StratagemStatsOptions,
): StratagemStats {
  const { page, kind } = options;
  const reader = new StatReader(raw, page);

  const general = (label: string, variants: readonly (string | null)[]) =>
    raw.general.find(
      (row) => row.section === "General" && row.label === label && variants.includes(row.variant),
    ) ?? null;
  const fromGeneral = <T>(
    row: RawGeneralRow | null,
    parse: (value: string, page: string) => T,
  ): Candidate<T> | null =>
    row
      ? {
          location: ["General", row.label, ...(row.variant ? [row.variant] : [])].join(SEP),
          value: parse(row.text, page),
        }
      : null;

  const cooldownVariants = raw.general.flatMap((row) => {
    if (row.section !== "General" || row.label !== "Cooldown" || STANDARD.includes(row.variant)) {
      return [];
    }
    const seconds = parseSeconds(row.text, page);
    return row.variant && seconds !== null ? [{ label: row.variant, seconds }] : [];
  });

  const weaponType = statValues(reader.infobox("weapon_type")?.lines ?? [])[0];
  const supportWeapon =
    kind === "support_weapon" && weaponType !== undefined && weaponType !== "Melee"
      ? readFirearm(reader, "supportWeapon", options.traitIds)
      : null;

  return {
    cooldownS: reader.scalar(
      "cooldownS",
      reader.fromInfobox(firstSeconds, "base_cooldown"),
      fromGeneral(general("Cooldown", STANDARD), parseSeconds),
      reader.fromTable(parseSeconds, "Cooldown"),
    ),
    cooldownVariants,
    callInTimeS: reader.scalar(
      "callInTimeS",
      fromGeneral(general("Call-in Time", STANDARD), parseSeconds),
      reader.fromTable(parseSeconds, "Call-in Time"),
    ),
    callInTimeUpgradedS:
      fromGeneral(general("Call-in Time", ["Upgraded"]), parseSeconds)?.value ?? null,
    uses: reader.scalar(
      "uses",
      fromGeneral(general("Uses", STANDARD), parseUses),
      reader.fromTable(parseUses, "Uses"),
    ),
    supportWeapon,
    backpack:
      kind === "backpack"
        ? {
            health: reader.fromTable(parseDecimal, "Main Health")?.value ?? null,
            armor: reader.fromTable(parsePenetration, "Main Armor")?.value ?? null,
            capacity: reader.fromTable(parseCount, "Capacity")?.value ?? null,
          }
        : null,
    attacks: readAttacks(raw, page),
    statsRaw: readStatsRaw(
      raw,
      raw.general.map((row) => ({
        path: [row.section, row.label, ...(row.variant ? [row.variant] : [])],
        text: row.text,
      })),
    ),
    conflicts: reader.conflicts,
  };
}
