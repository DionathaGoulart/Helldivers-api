import type {
  Attack,
  ConflictValue,
  FirearmStats,
  Id,
  MeleeStats,
  ThrowableStats,
  Weapon,
} from "@hd2/schemas";
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

// Weapon and stratagem pages → typed stats (arch §5.3 `FirearmStats`, `ThrowableStats`,
// `MeleeStats`, `Attack`), the raw bag and rule 2 conflicts (arch §5.5): the detailed table wins for scalars,
// the infobox wins when it carries more values; both originals stay in `statsRaw`.

export interface StatConflict {
  field: string; // "firearm.recoil"
  rule: 2;
  chosen: ConflictValue;
  candidates: { location: string; value: ConflictValue }[];
}

export interface WeaponStats {
  firearm: FirearmStats | null;
  throwable: ThrowableStats | null;
  melee: MeleeStats | null;
  attacks: Attack[];
  statsRaw: Record<string, string>;
  conflicts: StatConflict[];
}

export const SEP = " › ";

const valueText = (lines: readonly string[], text: string) =>
  lines.length > 1 ? lines.join(" / ") : text;

/** A page with a DRUID infobox and detailed statistics tables: weapons and stratagems. */
export type StatPage = Pick<RawWeaponPage, "name" | "infobox" | "tables">;

// Infobox rows typed elsewhere: the acquisition (source, cost) and the stratagem code arrows.
const UNTYPED_ROWS = new Set(["source", "cost", "unlock_cost", "stratagem_code"]);

/**
 * Every infobox row, extra row (a stratagem's `General` table) and stat table row as
 * label → text (arch §5.1 `statsRaw`).
 */
export function readStatsRaw(
  raw: StatPage,
  extraRows: readonly { path: readonly string[]; text: string }[] = [],
): Record<string, string> {
  const bag: Record<string, string> = {};
  const put = (key: string, value: string) => {
    let unique = key;
    for (let n = 2; unique in bag; n += 1) {
      unique = `${key} (${n})`;
    }
    bag[unique] = value;
  };
  for (const row of raw.infobox) {
    if (!UNTYPED_ROWS.has(row.key)) {
      put(row.label, valueText(row.lines, row.text));
    }
  }
  for (const row of extraRows) {
    put(row.path.join(SEP), row.text);
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

export interface Candidate<T> {
  location: string;
  value: T;
}

type Scalar = number | string | { horizontal: number; vertical: number };

/**
 * Reads a page's infobox rows and the main section of its weapon table, resolving values
 * found in both with rule 2 and recording the conflicts.
 */
export class StatReader {
  readonly conflicts: StatConflict[] = [];
  readonly weaponTable: RawStatTable | null;
  readonly tableTitle: string;

  constructor(
    readonly raw: StatPage,
    readonly page: string,
  ) {
    const weaponTables = raw.tables.filter((table) => table.kind === "weapon");
    if (weaponTables.length > 1) {
      throw new NormalizeError(
        page,
        raw.name,
        `expected 1 weapon stats table, found ${weaponTables.length}`,
      );
    }
    this.weaponTable = weaponTables[0] ?? null;
    this.tableTitle = this.weaponTable?.title ?? raw.name;
  }

  infobox(...keys: string[]): RawInfoboxRow | null {
    for (const key of keys) {
      const row = this.raw.infobox.find((candidate) => candidate.key === key);
      if (row) return row;
    }
    return null;
  }

  /** Main mode rows only: extra modes (`Underbarrel …`) and `Attacks` live in later sections. */
  tableRow(...labels: string[]): RawStatRow | null {
    const main = this.weaponTable?.sections.find((section) => section.title === null);
    for (const label of labels) {
      const row = main?.rows.find((candidate) => candidate.label === label);
      if (row) return row;
    }
    return null;
  }

  fromInfobox<T>(
    parse: (lines: readonly string[], page: string) => T,
    ...keys: string[]
  ): Candidate<T> | null {
    const row = this.infobox(...keys);
    return row
      ? { location: `infobox${SEP}${row.label}`, value: parse(row.lines, this.page) }
      : null;
  }

  fromTable<T>(
    parse: (value: string, page: string) => T,
    ...labels: string[]
  ): Candidate<T> | null {
    const row = this.tableRow(...labels);
    return row
      ? { location: `${this.tableTitle}${SEP}${row.label}`, value: parse(row.text, this.page) }
      : null;
  }

  /**
   * Rule 2 for scalars. Candidates go from the least to the most detailed source (infobox,
   * then table); the most detailed one with a value wins.
   */
  scalar<T extends Scalar>(field: string, ...candidates: (Candidate<T | null> | null)[]): T | null {
    const present = candidates.filter(
      (candidate): candidate is Candidate<T> => candidate?.value != null,
    );
    const chosen = present.at(-1)?.value ?? null;
    if (new Set(present.map((candidate) => JSON.stringify(candidate.value))).size > 1) {
      this.conflicts.push({
        field,
        rule: 2,
        chosen: chosen as ConflictValue,
        candidates: present as Candidate<ConflictValue>[],
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

/** `FirearmStats` of a weapon, or of the support weapon a stratagem calls (`field` prefixes conflicts). */
export function readFirearm(
  reader: StatReader,
  field: "firearm" | "supportWeapon",
  traitIds: readonly Id[],
): FirearmStats {
  const { page } = reader;
  const reloadTimeS = reader.scalar(
    `${field}.reloadTimeS`,
    reader.fromInfobox(firstSeconds, "reload_time", "rounds_reload_full_time"),
    reader.fromTable(parseSeconds, "Reload Time"),
  );
  const traits = new Set(traitIds);
  return {
    firingModes: parseFiringModes(reader.infobox("firing_modes")?.lines ?? [], page),
    fireRateRpm: reader.list(
      `${field}.fireRateRpm`,
      reader.fromInfobox((lines, p) => parseList(lines, parseRpm, p), "fire_rate"),
      reader.fromTable((value, p) => parseList([value], parseRpm, p), "Fire Rate"),
    ),
    dps: parseList(reader.infobox("dps")?.lines ?? [], parseDecimal, page),
    capacity: reader.scalar(
      `${field}.capacity`,
      reader.fromInfobox(firstCount, "capacity"),
      reader.fromTable(parseCount, "Capacity"),
    ),
    spareMagazines: reader.scalar(
      `${field}.spareMagazines`,
      reader.fromInfobox(firstCount, "spare_mags", "spare_rounds", "spare_shells"),
      reader.fromTable(parseCount, "Spare Magazines", "Spare Rounds"),
    ),
    startingMagazines:
      reader.fromTable(parseCount, "Starting Magazines", "Starting Rounds")?.value ?? null,
    magazinesFromSupply: reader.scalar(
      `${field}.magazinesFromSupply`,
      reader.fromInfobox(firstCount, "supply_box_refill"),
      reader.fromTable(parseCount, "Mags from Supply", "Rounds from Supply"),
    ),
    magazinesFromAmmoBox: reader.scalar(
      `${field}.magazinesFromAmmoBox`,
      reader.fromInfobox(firstCount, "ammo_box_refill"),
      reader.fromTable(parseCount, "Mags from Ammo Box", "Rounds from Ammo Box"),
    ),
    recoil: reader.scalar(
      `${field}.recoil`,
      reader.fromInfobox(firstDecimal, "recoil"),
      reader.fromTable(parseDecimal, "Recoil"),
    ),
    horizontalRecoil: reader.fromTable(parseDecimal, "Horizontal Recoil")?.value ?? null,
    verticalRecoil: reader.fromTable(parseDecimal, "Vertical Recoil")?.value ?? null,
    spread: reader.fromTable(parseSpread, "Spread")?.value ?? null,
    sway: reader.fromTable(parseDecimal, "Sway")?.value ?? null,
    ergonomics: reader.scalar(
      `${field}.ergonomics`,
      reader.fromInfobox(firstDecimal, "ergonomics"),
      reader.fromTable(parseDecimal, "Ergonomics"),
    ),
    reloadKind: traits.has("rounds-reload")
      ? "rounds"
      : traits.has("stationary-reload")
        ? "stationary"
        : reloadTimeS
          ? "magazine"
          : "none",
    reloadTimeS,
    reloadTimeUpgradedS: upgradedSeconds(reader.infobox("reload_time")?.lines ?? [], page),
    tacticalReloadTimeS: reader.scalar(
      `${field}.tacticalReloadTimeS`,
      reader.fromInfobox(firstSeconds, "tac_reload_time"),
      reader.fromTable(parseSeconds, "Tactical Reload"),
    ),
  };
}

function readThrowable(reader: StatReader): ThrowableStats {
  const cookable = statValues(reader.infobox("cookable")?.lines ?? [])[0];
  return {
    capacity: reader.scalar(
      "throwable.capacity",
      reader.fromInfobox(firstCount, "capacity"),
      reader.fromTable(parseCount, "Max Rounds"),
    ),
    startingCount: reader.fromTable(parseCount, "Starting Rounds")?.value ?? null,
    fromSupply: reader.fromTable(parseCount, "Throwables from Supply")?.value ?? null,
    fuseTimeS: reader.fromInfobox(firstSeconds, "fuse")?.value ?? null,
    cookable: cookable === undefined ? null : parseYesNo(cookable, reader.page),
  };
}

/** A melee weapon's swing rate: the wiki calls it Fire Rate (`N/A` in some infoboxes). */
function readMelee(reader: StatReader): MeleeStats {
  return {
    fireRateRpm: reader.list(
      "melee.fireRateRpm",
      reader.fromInfobox((lines, p) => parseList(lines, parseRpm, p), "fire_rate"),
      reader.fromTable((value, p) => parseList([value], parseRpm, p), "Fire Rate"),
    ),
  };
}

/** One `Attack` per stat table other than the weapon table, in page order. */
export function readAttacks(raw: StatPage, page: string): Attack[] {
  return raw.tables
    .filter((table) => table.kind !== "weapon")
    .map((table) => normalizeAttack(table, page));
}

export interface WeaponStatsOptions {
  page: string; // page URL, for errors
  category: Weapon["category"];
  subcategory: Weapon["subcategory"];
  traitIds: readonly Id[];
}

export function normalizeWeaponStats(raw: RawWeaponPage, options: WeaponStatsOptions): WeaponStats {
  const { page } = options;
  const reader = new StatReader(raw, page);
  const melee = options.subcategory === "melee";
  const armed = options.category !== "throwable" && !melee;
  return {
    firearm: armed ? readFirearm(reader, "firearm", options.traitIds) : null,
    throwable: options.category === "throwable" ? readThrowable(reader) : null,
    melee: melee ? readMelee(reader) : null,
    attacks: readAttacks(raw, page),
    statsRaw: readStatsRaw(raw),
    conflicts: reader.conflicts,
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
