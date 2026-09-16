import type { FiringMode, Penetration } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import { parseNumber } from "./numbers.ts";

// Stat cells of infoboxes and detailed tables (arch §4.5, §6.4). A cell may hold several
// lines (`6 (8mm)` / `3 (40mm)`) and `•`-separated values; scalars read the first value,
// lists read them all. Placeholders (`N/A`, `∞`) give null; any other unknown format throws.

const NONE = /^(?:|n\/a|∞|-|—|none|unknown|\?)$/i;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const NOTE = String.raw`(?:\s*\([^)]*\))*`; // trailing qualifiers: `(8mm)`, `(x2)`, `(Upgraded)`

/** Every value of every line, split on `•` and on spaced slashes (`5s / 15s`), trimmed. */
export function statValues(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    line
      .split(/•|\s+\/\s+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function first(lines: readonly string[]): string {
  return statValues(lines)[0] ?? "";
}

function match(value: string, pattern: string, page: string, hint: string): number | null {
  if (NONE.test(value)) {
    return null;
  }
  const found = new RegExp(`^~?\\s*(${NUMBER})${pattern}${NOTE}$`, "i").exec(value);
  if (!found?.[1]) {
    throw new NormalizeError(page, value, hint);
  }
  return parseNumber(found[1], page);
}

/** `65`, `~592`, `1,029.16`, `700 (0-25% heat)`. */
export function parseDecimal(value: string, page: string): number | null {
  return match(value, "", page, "not a number");
}

export const firstDecimal = (lines: readonly string[], page: string) =>
  parseDecimal(first(lines), page);

/** Whole counts: `45`, `8 Magazines`, `8 Clips`, `8 (x2)`. Heat weapons state capacity in seconds (`7s (87)`): null. */
export function parseCount(value: string, page: string): number | null {
  if (new RegExp(`^${NUMBER}\\s*s\\b`).test(value)) {
    return null;
  }
  const count = match(
    value,
    String.raw`(?:\s*(?:magazines?|clips?|rounds?|shells?))?`,
    page,
    "not a count",
  );
  if (count !== null && !Number.isInteger(count)) {
    throw new NormalizeError(page, value, "not a whole count");
  }
  return count;
}

export const firstCount = (lines: readonly string[], page: string) =>
  parseCount(first(lines), page);

/** `3s`, `2.5s(40mm)`, `0.2 sec`, `90 seconds`; fuse kinds such as `Impact` give null. */
export function parseSeconds(value: string, page: string): number | null {
  if (/^(?:impact|proximity)$/i.test(value)) {
    return null;
  }
  return match(value, String.raw`\s*(?:s|secs?|seconds?)`, page, "not a duration");
}

export const firstSeconds = (lines: readonly string[], page: string) =>
  parseSeconds(first(lines), page);

/** The line marked `(Upgraded)`, e.g. `4.1s (Upgraded)`. */
export function upgradedSeconds(lines: readonly string[], page: string): number | null {
  const upgraded = statValues(lines).find((value) => /\(upgraded\)/i.test(value));
  return upgraded ? parseSeconds(upgraded, page) : null;
}

/** `640 rpm`, `630rpm`, `117`. */
export function parseRpm(value: string, page: string): number | null {
  return match(value, String.raw`\s*(?:rpm)?`, page, "not a fire rate");
}

/** Every value of a list cell: `630rpm • 760rpm • 900rpm` → [630, 760, 900]. */
export function parseList(
  lines: readonly string[],
  parse: (value: string, page: string) => number | null,
  page: string,
): number[] {
  return statValues(lines).flatMap((value) => {
    const number = parse(value, page);
    return number === null ? [] : [number];
  });
}

/** `4.5 g`, `900 m/s`, `30%`, `2.25 m`, `x 9`. */
export function parseMeasure(value: string, unit: "g" | "m/s" | "%" | "m" | "x", page: string) {
  if (unit === "x") {
    const count = /^x\s*(\d+)$/i.exec(value)?.[1];
    if (!count) {
      throw new NormalizeError(page, value, "expected a multiplier such as `x 9`");
    }
    return Number(count);
  }
  const escaped = unit.replace("/", "\\/");
  return match(value, String.raw`\s*${escaped}`, page, `expected a value in ${unit}`);
}

/** `↔[2.00] ↕[2.00]` → { horizontal: 2, vertical: 2 }. */
export function parseSpread(value: string, page: string) {
  const found = new RegExp(String.raw`^↔\s*\[(${NUMBER})\]\s*↕\s*\[(${NUMBER})\]$`).exec(value);
  if (!found?.[1] || !found[2]) {
    throw new NormalizeError(page, value, "expected a spread such as `↔[2.00] ↕[2.00]`");
  }
  return { horizontal: parseNumber(found[1], page), vertical: parseNumber(found[2], page) };
}

/** `90 Ballistic` → { amount: 90, type: "Ballistic" }; `100 Fire DPS` keeps `Fire`. */
export function parseDamage(value: string, page: string) {
  const found = new RegExp(
    String.raw`^(${NUMBER})(?:\s+([A-Za-z][A-Za-z ]*?))?(?:\s+DPS)?${NOTE}$`,
  ).exec(value);
  if (!found?.[1]) {
    throw new NormalizeError(page, value, "expected damage such as `90 Ballistic`");
  }
  return { amount: parseNumber(found[1], page), type: found[2] ?? null };
}

const ROMAN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/;

/** `Light` → light, `Very Light` → very_light, `Anti-Tank III` → anti_tank_iii. */
export function parsePenetration(value: string, page: string): Penetration | null {
  if (NONE.test(value)) {
    return null;
  }
  const words = value.toLowerCase().trim();
  if (["unarmored", "very light", "light", "medium", "heavy"].includes(words)) {
    return words.replace(" ", "_");
  }
  const tier = /^anti-tank\s+([ivx]+)$/.exec(words)?.[1];
  if (tier && ROMAN.test(tier)) {
    return `anti_tank_${tier}`;
  }
  throw new NormalizeError(page, value, "unknown armor penetration");
}

export function parseYesNo(value: string, page: string): boolean | null {
  if (NONE.test(value)) {
    return null;
  }
  if (/^yes$/i.test(value)) return true;
  if (/^no$/i.test(value)) return false;
  throw new NormalizeError(page, value, "expected Yes or No");
}

// Firing mode labels seen on weapon pages (2026-09-16). Actions (`Bolt-Action`), guidance
// and ammo types (`40mm`, `10g`) are modes the enum does not name: `other`.
const FIRING_MODES: Readonly<Record<string, FiringMode | null>> = {
  auto: "auto",
  automatic: "auto",
  full: "auto",
  semi: "semi",
  "semi-automatic": "semi",
  burst: "burst",
  "burst fire": "burst",
  volley: "volley",
  "all barrel": "volley",
  charge: "charge",
  "bolt-action": "other",
  "lever-action": "other",
  "pump-action": "other",
  guided: "other",
  "non-guided": "other",
  total: "other",
  none: null,
};

/** `Auto • Semi • Burst` → ["auto", "semi", "burst"], unique, in wiki order. */
export function parseFiringModes(lines: readonly string[], page: string): FiringMode[] {
  const modes = statValues(lines).flatMap((value) => {
    const key = value.toLowerCase();
    if (/^\d+(?:\.\d+)?(?:mm|g)$/.test(key)) {
      return ["other" as const];
    }
    if (!Object.hasOwn(FIRING_MODES, key)) {
      throw new NormalizeError(page, value, "unknown firing mode; map it in normalize/stats.ts");
    }
    const mode = FIRING_MODES[key];
    return mode ? [mode] : [];
  });
  return [...new Set(modes)];
}
