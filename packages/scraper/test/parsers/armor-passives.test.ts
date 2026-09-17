import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import {
  ARMOR_PASSIVES_INDEX,
  parseArmorPassivePage,
  parseArmorPassives,
} from "../../src/parsers/armor-passives.ts";
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
        width: 512,
        height: 512,
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

describe("armor passive page parser", () => {
  it("reads the panel of a passive's own page, linked by its canonical title", async () => {
    const page = await fixture("Blunt-Force Mitigation");
    expect(parseArmorPassivePage(page.html, { url: page.url })).toEqual({
      name: "Blunt-Force Mitigation",
      page: { label: "Blunt-Force Mitigation", title: "Blunt-Force Mitigation", anchor: null },
      icon: {
        file: "Blunt-Force_Mitigation_Armor_Passive_Icon.png",
        src: "/images/Blunt-Force_Mitigation_Armor_Passive_Icon.png?b53dde",
        width: 167,
        height: 168,
      },
      description:
        "Makes Helldivers more resistant to being knocked off their feet when under attack and reduces any damage taken from impact and collisions by 30%, while also providing a higher armor rating.",
      effects: [
        "Makes Helldivers more resistant to being knocked off their feet when under attack and reduces any damage taken from impact and collisions by 30%, while also providing a higher armor rating.",
      ],
    });
  });

  it("needs exactly one panel", async () => {
    const index = await fixture(ARMOR_PASSIVES_INDEX);
    expect(() => parseArmorPassivePage(index.html, { url: index.url })).toThrow(
      "expected 1 passive panel, found 30",
    );
  });
});
