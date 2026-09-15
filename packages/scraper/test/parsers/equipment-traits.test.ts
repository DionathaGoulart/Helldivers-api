import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import {
  EQUIPMENT_TRAITS_INDEX,
  parseEquipmentTraits,
} from "../../src/parsers/equipment-traits.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("equipment-traits parser", async () => {
  const index = await fixture(EQUIPMENT_TRAITS_INDEX);
  const parsed = parseEquipmentTraits(index.html, { url: index.url });
  const members = parsed.traits.flatMap((trait) => trait.members);

  it("reads the list and every table of the fixture", async () => {
    expect(parsed.title).toBe("Equipment Traits");
    expect(parsed.listed).toHaveLength(28);
    expect(parsed.traits).toHaveLength(28);
    await expect(json(parsed)).toMatchFileSnapshot("./__snapshots__/equipment-traits.json");
  });

  it("reads list counts, including hyphenated names and a single item", () => {
    expect(parsed.listed).toContainEqual({ name: "Light Armor Penetrating", count: 38 });
    expect(parsed.listed).toContainEqual({ name: "Anti-Tank", count: 40 });
    expect(parsed.listed).toContainEqual({ name: "Stimulative", count: 1 });
  });

  it("reads heading anchors and members with page link, in-game name and type", () => {
    const lap = parsed.traits.find((trait) => trait.name === "Light Armor Penetrating");
    expect(lap?.anchor).toBe("Light_Armor_Penetrating");
    expect(lap?.members).toHaveLength(38);
    expect(lap?.members[0]).toEqual({
      page: { label: "AR-23 Liberator", title: "AR-23 Liberator", anchor: null },
      name: "AR-23 Liberator",
      type: "Weapon",
    });
    expect(members.find((m) => m.page.title === "CQC-72 Entrenchment Tool")?.name).toBe(
      "Trench Shovel",
    );
    expect(members.filter((m) => m.type === "Weapon")).toHaveLength(207);
    expect(members.filter((m) => m.type === "Stratagem")).toHaveLength(287);
  });

  it("fails loudly when the layout changes", () => {
    const parse = (html: string) => () => parseEquipmentTraits(html, { url: index.url });
    expect(parse(index.html.replace("<th>Type</th>", "<th>Kind</th>"))).toThrow(
      'missing column "Type"',
    );
    expect(parse(index.html.replace("<td>Stratagem</td>", "<td>Vehicle</td>"))).toThrow(ParseError);
    expect(parse(index.html.replace("<td>Explosive\n</td>", "<td>Incendiary\n</td>"))).toThrow(
      'row lists trait "Incendiary"',
    );
    expect(parse(index.html.replace("- 63 unique gear items", " (63)"))).toThrow(
      'unexpected entry "Explosive (63)"',
    );
    expect(parse(article("<p>gone</p>"))).toThrow("no trait list");
  });
});
