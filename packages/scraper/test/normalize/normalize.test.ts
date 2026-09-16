import { describe, expect, it } from "vitest";
import { NormalizeError } from "../../src/errors.ts";
import { parseFlag, parseLevel } from "../../src/normalize/cosmetics.ts";
import { parseCost } from "../../src/normalize/costs.ts";
import { parseNumber } from "../../src/normalize/numbers.ts";
import {
  normalizeWarbondLabel,
  pageFromAnchor,
  WarbondResolver,
  warbondIdFromTitle,
} from "../../src/normalize/warbonds.ts";

const PAGE = "https://helldivers.wiki.gg/wiki/Boosters";

describe("parseNumber", () => {
  it.each([
    ["15", 15],
    ["050", 50],
    ["1,140.3", 1140.3],
    ["2,015", 2015],
    [" 4.55 ", 4.55],
  ])("%s → %s", (text, value) => {
    expect(parseNumber(text, PAGE)).toBe(value);
  });

  it.each(["", "15 Medals", "∞", "1.2.3"])("rejects %j", (text) => {
    expect(() => parseNumber(text, PAGE)).toThrow(NormalizeError);
  });
});

describe("cosmetics cells", () => {
  it("reads emote flags and fails on anything else", () => {
    expect([parseFlag("✅", PAGE), parseFlag(" ❌ ", PAGE)]).toEqual([true, false]);
    expect(() => parseFlag("Yes", PAGE)).toThrow(NormalizeError);
  });

  it("reads whole non-negative levels", () => {
    expect([parseLevel("0", PAGE), parseLevel("300", PAGE)]).toEqual([0, 300]);
    expect(() => parseLevel("2.5", PAGE)).toThrow(NormalizeError);
    expect(() => parseLevel("Level 5", PAGE)).toThrow(NormalizeError);
  });
});

describe("parseCost", () => {
  it.each([
    [
      { text: "15 Medals", currency: "medals" },
      { currency: "medals", amount: 15 },
    ],
    [
      { text: "2,015", currency: "medals" },
      { currency: "medals", amount: 2015 },
    ],
    [
      { text: "4000 Requisition Slips", currency: "requisition" },
      { currency: "requisition", amount: 4000 },
    ],
    [
      { text: "💲20", currency: "usd" },
      { currency: "usd", amount: 20 },
    ],
    [
      { text: "Free", currency: "requisition" },
      { currency: "requisition", amount: 0 },
    ],
    [{ text: "N/A", currency: null }, null],
    [{ text: "❌", currency: null }, null],
    [{ text: "/", currency: null }, null],
    [{ text: "", currency: null }, null],
  ] as const)("%j → %j", (raw, cost) => {
    expect(parseCost(raw, PAGE)).toEqual(cost);
  });

  it("uses the fallback currency only when the cell has no icon", () => {
    expect(
      parseCost({ text: "Free", currency: null }, PAGE, { fallbackCurrency: "requisition" }),
    ).toEqual({
      currency: "requisition",
      amount: 0,
    });
  });

  it.each([
    { text: "15", currency: null },
    { text: "150 45", currency: "super_credits" },
  ] as const)("rejects %j", (raw) => {
    expect(() => parseCost(raw, PAGE)).toThrow(NormalizeError);
  });
});

describe("warbonds", () => {
  it.each([
    ["Helldivers Mobilize Warbond", "helldivers-mobilize"],
    ["Castellan's Creed Legendary Warbond", "castellans-creed"],
    ["Freedom's Flame Premium Warbond", "freedoms-flame"],
    [
      "Obedient Democracy Support Troopers Legendary Warbond",
      "obedient-democracy-support-troopers",
    ],
    ["Boosters", null],
  ])("id from title %s → %s", (title, id) => {
    expect(warbondIdFromTitle(title)).toBe(id);
  });

  it("normalizes labels and anchors", () => {
    expect(normalizeWarbondLabel("Castellan’s  Creed P1")).toBe("Castellan's Creed");
    expect(pageFromAnchor("Page_10")).toBe(10);
    expect(pageFromAnchor("Overview")).toBeNull();
    expect(pageFromAnchor(null)).toBeNull();
  });

  const resolver = new WarbondResolver({
    knownIds: new Set(["helldivers-mobilize", "castellans-creed"]),
    aliases: {
      "Helldivers Mobilize!": "helldivers-mobilize",
      "Castellan’s Creed": "castellans-creed",
    },
  });

  it("resolves by href target first, then by alias", () => {
    expect(resolver.resolve({ title: "Helldivers Mobilize Warbond" }, "whatever", PAGE)).toBe(
      "helldivers-mobilize",
    );
    expect(resolver.resolve(null, "Helldivers Mobilize!", PAGE)).toBe("helldivers-mobilize");
    expect(resolver.resolve({ title: "Castellans Creed" }, "Castellan's Creed P2", PAGE)).toBe(
      "castellans-creed",
    );
  });

  it("fails on an unknown warbond", () => {
    expect(() =>
      resolver.resolve({ title: "Urban Legends Premium Warbond" }, "Urban Legends", PAGE),
    ).toThrow("id urban-legends not a known warbond");
    expect(() => resolver.resolve(null, "Halo: ODST", PAGE)).toThrow(NormalizeError);
  });
});
