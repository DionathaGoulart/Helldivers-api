import { describe, expect, it } from "vitest";
import { Id, Image, Penetration, Source, WikiRef } from "../src/common.ts";

const warbondSource = {
  type: "warbond",
  label: "Castellan's Creed P1",
  warbondId: "castellans-creed",
  page: 1,
  cost: { currency: "medals", amount: 45 },
  rotating: null,
};

describe("Id", () => {
  it.each(["ar-23-liberator", "40-k-meltagun", "sta-x3-wasp-launcher"])("accepts %s", (id) => {
    expect(Id.safeParse(id).success).toBe(true);
  });

  it.each(["AR-23", "ar--23", "-ar", "ar-", "ar_23", ""])("rejects %j", (id) => {
    expect(Id.safeParse(id).success).toBe(false);
  });
});

describe("WikiRef", () => {
  it("accepts wiki page urls with anchors and apostrophes", () => {
    const ref = {
      title: "City Fighter's Resolve",
      url: "https://helldivers.wiki.gg/wiki/City_Fighter's_Resolve#Cape",
      flags: ["stub"],
    };
    expect(WikiRef.safeParse(ref).success).toBe(true);
  });

  it.each([
    "http://helldivers.wiki.gg/wiki/Boosters",
    "https://helldivers2.fandom.com/wiki/Boosters",
  ])("rejects %s", (url) => {
    expect(WikiRef.safeParse({ title: "Boosters", url, flags: [] }).success).toBe(false);
  });
});

describe("Image", () => {
  it("requires a content-hashed webp path", () => {
    const image = { width: 256, height: 256, wikiFile: "True_Grit_Armor_Passive_Icon.svg" };
    expect(
      Image.safeParse({ ...image, url: "/images/v1/passives/true-grit.0a1b2c3d.webp" }).success,
    ).toBe(true);
    expect(Image.safeParse({ ...image, url: "/images/v1/passives/true-grit.webp" }).success).toBe(
      false,
    );
  });
});

describe("Source", () => {
  it("accepts a warbond source with page", () => {
    expect(Source.safeParse(warbondSource).success).toBe(true);
  });

  it("rejects a warbond source without page", () => {
    const result = Source.safeParse({ ...warbondSource, page: null });
    expect(result.error?.issues[0]?.message).toBe("warbond source needs warbondId and page");
  });

  it("rejects warbondId on other source types", () => {
    const result = Source.safeParse({ ...warbondSource, type: "default" });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "warbondId only allowed on warbond sources",
    );
  });

  it("rejects rotating outside the superstore", () => {
    const result = Source.safeParse({ ...warbondSource, rotating: false });
    expect(result.error?.issues[0]?.message).toBe("rotating is set only for superstore");
  });

  it("requires rotating on superstore sources", () => {
    const superstore = { ...warbondSource, type: "superstore", warbondId: null, page: null };
    expect(Source.safeParse(superstore).success).toBe(false);
    expect(Source.safeParse({ ...superstore, rotating: false }).success).toBe(true);
  });
});

describe("Penetration", () => {
  it.each(["unarmored", "very_light", "medium", "anti_tank_iii"])("accepts %s", (value) => {
    expect(Penetration.safeParse(value).success).toBe(true);
  });

  it.each(["Anti-Tank III", "anti_tank_4", "ultra"])("rejects %s", (value) => {
    expect(Penetration.safeParse(value).success).toBe(false);
  });
});
