import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { ARMOR_PASSIVES_INDEX, parseArmorPassives } from "../../src/parsers/armor-passives.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("armor-passives parser", async () => {
  const index = await fixture(ARMOR_PASSIVES_INDEX);
  const passives = parseArmorPassives(index.html, { url: index.url });

  it("reads every panel of the fixture", async () => {
    expect(passives).toHaveLength(30);
    await expect(json(passives)).toMatchFileSnapshot("./__snapshots__/armor-passives.json");
  });

  it("reads True Grit as in arch §5.4", () => {
    expect(passives[0]).toEqual({
      name: "True Grit",
      page: { label: "True Grit", title: "True Grit", anchor: null },
      icon: {
        file: "True_Grit_Armor_Passive_Icon.svg",
        src: "/images/True_Grit_Armor_Passive_Icon.svg?4e2218",
      },
      description:
        "Increases reload speed of support weapons by 30%. Slightly increases weapon ergonomics to reduce drag on weapon movement.",
      effects: [
        "Increases reload speed of support weapons by 30%.",
        "Slightly increases weapon ergonomics to reduce drag on weapon movement.",
      ],
    });
  });

  it("keeps commas in names and splits every <br> line", () => {
    const hazmat = passives.find((passive) => passive.name === "Concussive Padding, Hazmat");
    expect(hazmat?.page.title).toBe("Concussive Padding, Hazmat");
    expect(hazmat?.effects).toHaveLength(3);
    expect(passives.filter((passive) => passive.effects.length === 1)).toHaveLength(5);
  });

  it("fails loudly when the layout changes", () => {
    expect(() => parseArmorPassives(article("<p>gone</p>"), { url: index.url })).toThrow(
      "no passive panels",
    );
    const noDescription = article(
      '<div class="armor-passive-panel"><div class="armor-passive-header"><a href="/wiki/Scout">Scout</a></div></div>',
    );
    expect(() => parseArmorPassives(noDescription, { url: index.url })).toThrow(ParseError);
  });
});
