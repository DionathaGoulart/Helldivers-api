import type { Attack, ConflictValue, FirearmStats, Id, ThrowableStats, Weapon } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import type {
  RawInfoboxRow,
  RawStatRow,
  RawStatTable,
  RawWeaponPage,
} from "../parsers/weapon-page.ts";
import {
  firstCount,
  firstDecimal,
  firstSeconds,
  parseCount,
  parseDamage,
  parseDecimal,
  parseFiringModes,
  parseList,
  parseMeasure,
  parsePenetration,
  parseRpm,
  parseSeconds,
  parseSpread,
  parseYesNo,
  statValues,
  upgradedSeconds,
} from "./stats.ts";

// Weapon page → typed stats (arch §5.3 `FirearmStats`, `ThrowableStats`, `Attack`), the raw
// bag and rule 2 conflicts (arch §5.5): the detailed table wins for scalars, the infobox wins
// when it carries more values; both originals stay in `statsRaw`.

export interface StatConflict {
  field: string; // "firearm.recoil"
  rule: 2;
  chosen: ConflictValue;
  candidates: { location: string; value: ConflictValue }[];
}

export interface WeaponStats {
  firearm: FirearmStats | null;
  throwable: ThrowableStats | null;
  attacks: Attack[];
  statsRaw: Record<string, string>;
  conflicts: StatConflict[];
}

const SEP = " › ";

const valueText = (lines: readonly string[], text: string) =>
  lines.length > 1 ? lines.join(" / ") : text;

function readStatsRaw(raw: RawWeaponPage): Record<string, string> {
  const bag: Record<string, string> = {};
  const put = (key: string, value: string) => {
    let unique = key;
    for (let n = 2; unique in bag; n += 1) {
      unique = `${key} (${n})`;
    }
    bag[unique] = value;
  };
  for (const row of raw.infobox) {
    if (row.key !== "source" && row.key !== "cost") {
      put(row.label, valueText(row.lines, row.text));
    }
  }
  for (const table of raw.tables) {
    const title = table.title ?? table.id ?? raw.name;
    for (const section of table.sections) {
      for (const row of section.rows) {
        const path = [title, ...(section.title ? [section.title] : []), row.label];
        put(path.join(SEP), valueText(row.lines, row.text));
      }
    }
  }
  return bag;
}

interface Candidate<T> {
  location: string;
  value: T;
}

class Resolver {
  readonly conflicts: StatConflict[] = [];

  /** Rule 2 for scalars: the table wins when it has a value. */
  scalar<T extends number | { horizontal: number; vertical: number }>(
    field: string,
    infobox: Candidate<T | null> | null,
    table: Candidate<T | null> | null,
  ): T | null {
    const chosen = table?.value ?? infobox?.value ?? null;
    if (
      infobox?.value != null &&
      table?.value != null &&
      JSON.stringify(infobox.value) !== JSON.stringify(table.value)
    ) {
      this.conflicts.push({
        field,
        rule: 2,
        chosen: chosen as ConflictValue,
        candidates: [infobox as Candidate<ConflictValue>, table as Candidate<ConflictValue>],
      });
    }
    return chosen;
  }

  /** Rule 2 for lists: the infobox wins when it carries more values. */
  list(field: string, infobox: Candidate<number[]> | null, table: Candidate<number[]> | null) {
    const a = infobox?.value ?? [];
    const b = table?.value ?? [];
    const chosen = a.length > b.length || b.length === 0 ? a : b;
    const other = chosen === a ? b : a;
    if (
      infobox &&
      table &&
      a.length > 0 &&
      b.length > 0 &&
      other.some((v) => !chosen.includes(v))
    ) {
      this.conflicts.push({
        field,
        rule: 2,
        chosen,
        candidates: [infobox, table],
      });
    }
    return chosen;
  }
}

export interface WeaponStatsOptions {
  page: string; // page URL, for errors
  category: Weapon["category"];
  subcategory: Weapon["subcategory"];
  traitIds: readonly Id[];
}

export function normalizeWeaponStats(raw: RawWeaponPage, options: WeaponStatsOptions): WeaponStats {
  const { page } = options;
  const resolver = new Resolver();

  const weaponTables = raw.tables.filter((table) => table.kind === "weapon");
  if (weaponTables.length > 1) {
    throw new NormalizeError(
      page,
      raw.name,
      `expected 1 weapon stats table, found ${weaponTables.length}`,
    );
  }
  const weaponTable = weaponTables[0] ?? null;
  const tableTitle = weaponTable?.title ?? raw.name;

  const infobox = (...keys: string[]): RawInfoboxRow | null => {
    for (const key of keys) {
      const row = raw.infobox.find((candidate) => candidate.key === key);
      if (row) return row;
    }
    return null;
  };
  // Main mode rows only: extra modes (`Underbarrel …`) and `Attacks` live in later sections.
  const tableRow = (...labels: string[]): RawStatRow | null => {
    const main = weaponTable?.sections.find((section) => section.title === null);
    for (const label of labels) {
      const row = main?.rows.find((candidate) => candidate.label === label);
      if (row) return row;
    }
    return null;
  };

  const fromInfobox = <T>(
    parse: (lines: readonly string[], page: string) => T,
    ...keys: string[]
  ): Candidate<T> | null => {
    const row = infobox(...keys);
    return row ? { location: `infobox${SEP}${row.label}`, value: parse(row.lines, page) } : null;
  };
  const fromTable = <T>(
    parse: (value: string, page: string) => T,
    ...labels: string[]
  ): Candidate<T> | null => {
    const row = tableRow(...labels);
    return row
      ? { location: `${tableTitle}${SEP}${row.label}`, value: parse(row.text, page) }
      : null;
  };

  let firearm: FirearmStats | null = null;
  const armed = options.category !== "throwable" && options.subcategory !== "melee";
  if (armed) {
    const reloadTimeS = resolver.scalar(
      "firearm.reloadTimeS",
      fromInfobox(firstSeconds, "reload_time", "rounds_reload_full_time"),
      fromTable(parseSeconds, "Reload Time"),
    );
    const traits = new Set(options.traitIds);
    firearm = {
      firingModes: parseFiringModes(infobox("firing_modes")?.lines ?? [], page),
      fireRateRpm: resolver.list(
        "firearm.fireRateRpm",
        fromInfobox((lines, p) => parseList(lines, parseRpm, p), "fire_rate"),
        fromTable((value, p) => parseList([value], parseRpm, p), "Fire Rate"),
      ),
      dps: parseList(infobox("dps")?.lines ?? [], parseDecimal, page),
      capacity: resolver.scalar(
        "firearm.capacity",
        fromInfobox(firstCount, "capacity"),
        fromTable(parseCount, "Capacity"),
      ),
      spareMagazines: resolver.scalar(
        "firearm.spareMagazines",
        fromInfobox(firstCount, "spare_mags", "spare_rounds", "spare_shells"),
        fromTable(parseCount, "Spare Magazines", "Spare Rounds"),
      ),
      startingMagazines:
        fromTable(parseCount, "Starting Magazines", "Starting Rounds")?.value ?? null,
      magazinesFromSupply: resolver.scalar(
        "firearm.magazinesFromSupply",
        fromInfobox(firstCount, "supply_box_refill"),
        fromTable(parseCount, "Mags from Supply", "Rounds from Supply"),
      ),
      magazinesFromAmmoBox: resolver.scalar(
        "firearm.magazinesFromAmmoBox",
        fromInfobox(firstCount, "ammo_box_refill"),
        fromTable(parseCount, "Mags from Ammo Box", "Rounds from Ammo Box"),
      ),
      recoil: resolver.scalar(
        "firearm.recoil",
        fromInfobox(firstDecimal, "recoil"),
        fromTable(parseDecimal, "Recoil"),
      ),
      horizontalRecoil: fromTable(parseDecimal, "Horizontal Recoil")?.value ?? null,
      verticalRecoil: fromTable(parseDecimal, "Vertical Recoil")?.value ?? null,
      spread: fromTable(parseSpread, "Spread")?.value ?? null,
      sway: fromTable(parseDecimal, "Sway")?.value ?? null,
      ergonomics: resolver.scalar(
        "firearm.ergonomics",
        fromInfobox(firstDecimal, "ergonomics"),
        fromTable(parseDecimal, "Ergonomics"),
      ),
      reloadKind: traits.has("rounds-reload")
        ? "rounds"
        : traits.has("stationary-reload")
          ? "stationary"
          : reloadTimeS
            ? "magazine"
            : "none",
      reloadTimeS,
      reloadTimeUpgradedS: upgradedSeconds(infobox("reload_time")?.lines ?? [], page),
      tacticalReloadTimeS: resolver.scalar(
        "firearm.tacticalReloadTimeS",
        fromInfobox(firstSeconds, "tac_reload_time"),
        fromTable(parseSeconds, "Tactical Reload"),
      ),
    };
  }

  let throwable: ThrowableStats | null = null;
  if (options.category === "throwable") {
    const cookable = statValues(infobox("cookable")?.lines ?? [])[0];
    throwable = {
      capacity: resolver.scalar(
        "throwable.capacity",
        fromInfobox(firstCount, "capacity"),
        fromTable(parseCount, "Max Rounds"),
      ),
      startingCount: fromTable(parseCount, "Starting Rounds")?.value ?? null,
      fromSupply: fromTable(parseCount, "Throwables from Supply")?.value ?? null,
      fuseTimeS: fromInfobox(firstSeconds, "fuse")?.value ?? null,
      cookable: cookable === undefined ? null : parseYesNo(cookable, page),
    };
  }

  return {
    firearm,
    throwable,
    attacks: raw.tables
      .filter((table) => table.kind !== "weapon")
      .map((table) => normalizeAttack(table, page)),
    statsRaw: readStatsRaw(raw),
    conflicts: resolver.conflicts,
  };
}

const DIRECT_KINDS: ReadonlySet<string> = new Set([
  "projectile",
  "explosion",
  "beam",
  "arc",
  "spray",
  "status",
]);

/** One attack table (`attack-data-table-<kind>`) → `Attack`. */
export function normalizeAttack(table: RawStatTable, page: string): Attack {
  const cell = (section: string | readonly string[], label: string): string | null => {
    const titles = typeof section === "string" ? [section] : section;
    for (const title of titles) {
      const row = table.sections
        .find((candidate) => candidate.title === title)
        ?.rows.find((candidate) => candidate.label === label);
      if (row) return row.text;
    }
    return null;
  };
  const read = <T>(value: string | null, parse: (value: string, page: string) => T): T | null =>
    value === null ? null : parse(value, page);

  const element = cell("Damage", "Element") ?? cell("Damage", "Damage Element");
  let kind: Attack["kind"];
  if (DIRECT_KINDS.has(table.kind)) {
    kind = table.kind as Attack["kind"];
  } else if (table.kind === "damage") {
    kind = element === "Melee" ? "melee" : "other";
  } else {
    throw new NormalizeError(page, table.kind, "unknown attack table kind");
  }

  const standard = read(cell("Damage", "Standard") ?? cell("Damage", "Inner Radius"), parseDamage);
  const durable = read(
    cell("Damage", "vs. Durable") ?? cell("Damage", "Inner Durable"),
    parseDamage,
  );
  const measure = (label: string, unit: "g" | "m/s" | "%" | "m" | "x", section = "Projectile") =>
    read(cell(section, label), (value, p) => parseMeasure(value, unit, p));
  const forces = ["Special Effects", "AoE Effect"];

  return {
    name: table.title ?? table.id ?? table.kind,
    kind,
    damage: {
      standard: standard?.amount ?? null,
      durable: durable?.amount ?? null,
      type: standard?.type ?? (element && element !== "None" ? element : null),
    },
    penetration: {
      direct: read(cell("Penetration", "Direct"), parsePenetration),
      slightAngle: read(cell("Penetration", "Slight Angle"), parsePenetration),
      largeAngle: read(cell("Penetration", "Large Angle"), parsePenetration),
      extremeAngle: read(cell("Penetration", "Extreme Angle"), parsePenetration),
    },
    projectile:
      kind === "projectile"
        ? {
            pellets: measure("Pellets", "x"),
            massG: measure("Mass", "g"),
            initialVelocityMps: measure("Initial Velocity", "m/s"),
            dragFactorPct: measure("Drag Factor", "%"),
            gravityFactorPct: measure("Gravity Factor", "%"),
            penetrationSlowdownPct: measure("Penetration Slowdown", "%"),
          }
        : null,
    area:
      kind === "explosion"
        ? {
            innerRadiusM: measure("Inner Radius", "m", "Area of Effect"),
            outerRadiusM: measure("Outer Radius", "m", "Area of Effect"),
            shockwaveRadiusM: measure("Shockwave Radius", "m", "Area of Effect"),
          }
        : null,
    forces: {
      demolition: read(cell(forces, "Demolition Force"), parseDecimal),
      stagger: read(cell(forces, "Stagger Force"), parseDecimal),
      push: read(cell(forces, "Push Force"), parseDecimal),
    },
  };
}
