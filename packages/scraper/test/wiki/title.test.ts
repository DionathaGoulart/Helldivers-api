import { describe, expect, it } from "vitest";
import {
  fixtureFileName,
  linkFromHref,
  normalizeTitle,
  titleToPath,
  wikiUrl,
} from "../../src/wiki/title.ts";

describe("wiki titles", () => {
  it("normalizes underscores and spaces", () => {
    expect(normalizeTitle(" Castellan's_Creed__Legendary_Warbond ")).toBe(
      "Castellan's Creed Legendary Warbond",
    );
  });

  it.each([
    ["City Fighter's Resolve", "/wiki/City_Fighter's_Resolve"],
    ["R/40-K Hot-Shot Marksman Rifle", "/wiki/R/40-K_Hot-Shot_Marksman_Rifle"],
    ["Castellan’s Creed", "/wiki/Castellan%E2%80%99s_Creed"],
    ["Halo: ODST?", "/wiki/Halo:_ODST%3F"],
  ])("paths %s as %s", (title, path) => {
    expect(titleToPath(title)).toBe(path);
  });

  it("builds wiki URLs with anchors", () => {
    expect(wikiUrl("Equipment Traits", "Light_Armor_Penetrating")).toBe(
      "https://helldivers.wiki.gg/wiki/Equipment_Traits#Light_Armor_Penetrating",
    );
  });

  it.each([
    [
      "/wiki/Freedom%27s_Flame_Premium_Warbond#Page_3",
      { title: "Freedom's Flame Premium Warbond", anchor: "Page_3" },
    ],
    ["https://helldivers.wiki.gg/wiki/Boosters", { title: "Boosters", anchor: null }],
    ["/index.php?title=Nope&action=edit&redlink=1", null],
    ["https://example.com/wiki/Boosters", null],
    ["/images/Medal.svg", null],
  ])("reads link %s", (href, expected) => {
    expect(linkFromHref(href)).toEqual(expected);
  });

  it("names fixture files safely", () => {
    expect(fixtureFileName("R/40-K Hot-Shot Marksman Rifle")).toBe(
      "R%2F40-K_Hot-Shot_Marksman_Rifle.html",
    );
    expect(fixtureFileName("City Fighter's Resolve")).toBe("City_Fighter's_Resolve.html");
  });
});
