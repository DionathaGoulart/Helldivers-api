import { describe, expect, it } from "vitest";
import { dynamicETag, fnv1a64, matchesIfNoneMatch } from "../src/lib/etag.ts";
import { matchScore, normalizeText, searchTerms, textQuery } from "../src/lib/text.ts";

describe("fnv1a64", () => {
  it.each([
    ["", "cbf29ce484222325"],
    ["a", "af63dc4c8601ec8c"],
    ["foobar", "85944171f73967e8"],
  ])("hashes %j", (text, hash) => {
    expect(fnv1a64(text)).toBe(hash);
  });

  it("builds weak ETags", () => {
    expect(dynamicETag("2026-09-17.2d3c0c72", "")).toBe('W/"2026-09-17.2d3c0c72-cbf29ce484222325"');
  });
});

describe("matchesIfNoneMatch", () => {
  it.each([
    [undefined, false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", W/"abc"', true],
    ["*", true],
    ['"abcd"', false],
  ])("%j", (header, expected) => {
    expect(matchesIfNoneMatch(header, 'W/"abc"')).toBe(expected);
  });
});

describe("text matching", () => {
  it("normalizes case, diacritics and punctuation", () => {
    expect(normalizeText(" Castellan’s  CRÉED! ")).toBe("castellan s creed");
    expect(normalizeText("StA-X3 W.A.S.P. Launcher")).toBe("sta x3 w a s p launcher");
  });

  it("needs two letters or digits", () => {
    expect(textQuery("a")).toBeNull();
    expect(textQuery("- a -")).toBeNull();
    expect(textQuery("a-2")).toEqual({ normalized: "a 2", compact: "a2" });
  });

  it("ranks exact < prefix < word prefix < substring < compact substring", () => {
    const score = (term: string, q: string) =>
      matchScore([normalizeText(term)], textQuery(q) ?? { normalized: "", compact: "" });
    expect(score("AR-23 Liberator", "ar 23 liberator")).toBe(0);
    expect(score("AR-23 Liberator", "ar-23")).toBe(1);
    expect(score("AR-23 Liberator", "lib")).toBe(2);
    expect(score("AR-23 Liberator", "bera")).toBe(3);
    expect(score("AR-23 Liberator", "ar23")).toBe(4);
    expect(score("AR-23 Liberator", "sg")).toBeNull();
  });

  it("keeps the best score over name and aliases", () => {
    expect(
      matchScore(
        searchTerms("Orbital Precision Strike", ["OPS"]),
        textQuery("ops") ?? { normalized: "", compact: "" },
      ),
    ).toBe(0);
    expect(searchTerms("Castellan's Creed", ["Castellan’s Creed"])).toEqual(["castellan s creed"]);
  });
});
