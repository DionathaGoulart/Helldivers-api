import { describe, expect, it } from "vitest";
import { NormalizeError } from "../../src/errors.ts";
import {
  firstCount,
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
} from "../../src/normalize/stats.ts";

const PAGE = "https://helldivers.wiki.gg/wiki/AR-23_Liberator";

describe("stat values", () => {
  it("splits lines, bullets and spaced slashes, keeping unit slashes", () => {
    expect(statValues(["• Auto", "• Semi"])).toEqual(["Auto", "Semi"]);
    expect(statValues(["2 (12mm) • 1 (Flamethrower)"])).toEqual(["2 (12mm)", "1 (Flamethrower)"]);
    expect(statValues(["5s / 15s / 60s"])).toEqual(["5s", "15s", "60s"]);
    expect(statValues(["900 m/s"])).toEqual(["900 m/s"]);
  });
});

describe("numbers", () => {
  it.each([
    ["65", 65],
    ["~592", 592],
    ["1,029.16", 1029.16],
    ["700 (0-25% heat)", 700],
    ["N/A", null],
    ["∞", null],
  ])("decimal %j → %j", (value, expected) => {
    expect(parseDecimal(value, PAGE)).toBe(expected);
  });

  it.each([
    ["45", 45],
    ["8 Magazines", 8],
    ["8 Clips", 8],
    ["8 (x2)", 8],
    ["45 (4mm)", 45],
    ["7s (87)", null],
    ["15s (175) (Fires Indefinitely)", null],
    ["N/A", null],
  ])("count %j → %j", (value, expected) => {
    expect(parseCount(value, PAGE)).toBe(expected);
  });

  it.each([
    ["3s", 3],
    ["2.5s(40mm)", 2.5],
    ["0.2 sec", 0.2],
    ["90 seconds", 90],
    ["Impact", null],
    ["Proximity", null],
  ])("seconds %j → %j", (value, expected) => {
    expect(parseSeconds(value, PAGE)).toBe(expected);
  });

  it("reads the first value of a cell and the upgraded line", () => {
    expect(firstCount(["6 (8mm)", "3 (40mm)"], PAGE)).toBe(6);
    expect(firstSeconds(["5s / 15s / 60s"], PAGE)).toBe(5);
    expect(upgradedSeconds(["4.55s", "4.1s (Upgraded)"], PAGE)).toBe(4.1);
    expect(upgradedSeconds(["3s"], PAGE)).toBeNull();
  });

  it("reads lists", () => {
    expect(parseList(["630rpm • 760rpm • 900rpm"], parseRpm, PAGE)).toEqual([630, 760, 900]);
    expect(parseList(["640 rpm"], parseRpm, PAGE)).toEqual([640]);
    expect(parseList(["N/A"], parseRpm, PAGE)).toEqual([]);
    expect(parseList(["513 (Flechette)", "160 (Stun)"], parseDecimal, PAGE)).toEqual([513, 160]);
  });

  it("reads measures, spread and damage", () => {
    expect(parseMeasure("4.5 g", "g", PAGE)).toBe(4.5);
    expect(parseMeasure("900 m/s", "m/s", PAGE)).toBe(900);
    expect(parseMeasure("30%", "%", PAGE)).toBe(30);
    expect(parseMeasure("2.25 m", "m", PAGE)).toBe(2.25);
    expect(parseMeasure("x 9", "x", PAGE)).toBe(9);
    expect(parseSpread("↔[2.00] ↕[30.00]", PAGE)).toEqual({ horizontal: 2, vertical: 30 });
    expect(parseDamage("90 Ballistic", PAGE)).toEqual({ amount: 90, type: "Ballistic" });
    expect(parseDamage("1,000 Explosion", PAGE)).toEqual({ amount: 1000, type: "Explosion" });
    expect(parseDamage("100 Fire DPS", PAGE)).toEqual({ amount: 100, type: "Fire" });
  });

  it.each([
    [() => parseDecimal("Recoil", PAGE)],
    [() => parseCount("4.5", PAGE)],
    [() => parseSeconds("soon", PAGE)],
    [() => parseMeasure("900 km/h", "m/s", PAGE)],
    [() => parseSpread("2 × 2", PAGE)],
    [() => parseDamage("399 - 0", PAGE)],
  ])("rejects unknown formats (%#)", (parse) => {
    expect(parse).toThrow(NormalizeError);
  });
});

describe("enums", () => {
  it.each([
    ["Unarmored", "unarmored"],
    ["Very Light", "very_light"],
    ["Heavy", "heavy"],
    ["Anti-Tank III", "anti_tank_iii"],
    ["N/A", null],
  ])("penetration %j → %j", (value, expected) => {
    expect(parsePenetration(value, PAGE)).toBe(expected);
  });

  it("rejects an unknown penetration", () => {
    expect(() => parsePenetration("Super Heavy", PAGE)).toThrow("unknown armor penetration");
  });

  it("maps firing modes, deduplicated in wiki order", () => {
    expect(parseFiringModes(["Semi • Burst • Full"], PAGE)).toEqual(["semi", "burst", "auto"]);
    expect(parseFiringModes(["• Auto", "• Semi", "• Burst"], PAGE)).toEqual([
      "auto",
      "semi",
      "burst",
    ]);
    expect(parseFiringModes(["4mm • 10g"], PAGE)).toEqual(["other"]);
    expect(parseFiringModes(["Bolt-Action"], PAGE)).toEqual(["other"]);
    expect(parseFiringModes(["None"], PAGE)).toEqual([]);
    expect(() => parseFiringModes(["Laser Guided"], PAGE)).toThrow("unknown firing mode");
    expect(() => parseFiringModes(["constructor"], PAGE)).toThrow("unknown firing mode");
  });

  it("reads Yes and No", () => {
    expect(parseYesNo("Yes", PAGE)).toBe(true);
    expect(parseYesNo("No", PAGE)).toBe(false);
    expect(() => parseYesNo("Sometimes", PAGE)).toThrow(NormalizeError);
  });
});
