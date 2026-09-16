import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { findItem, parseWarbondPage } from "../../src/parsers/warbond-page.ts";
import { parseWeaponPage } from "../../src/parsers/weapon-page.ts";
import { parseWeaponsIndex, WEAPONS_INDEX } from "../../src/parsers/weapons-index.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("weapons-index parser", async () => {
  const index = await fixture(WEAPONS_INDEX);
  const rows = parseWeaponsIndex(index.html, { url: index.url });
  const count = (category: string) => rows.filter((row) => row.category === category).length;

  it("reads every weapon tab of the fixture and skips the stratagem support weapon tabs", async () => {
    expect([count("Primary"), count("Secondary"), count("Throwable"), count("Civilian")]).toEqual([
      54, 25, 23, 2,
    ]);
    expect(rows.some((row) => row.name === "MG-43 Machine Gun")).toBe(false);
    await expect(json(rows)).toMatchFileSnapshot("./__snapshots__/weapons-index.json");
  });

  it("reads the Civilian tab without a subcategory", () => {
    expect(rows.filter((row) => row.category === "Civilian")).toEqual([
      expect.objectContaining({
        name: "SG-88 Break-Action Shotgun",
        page: {
          label: "SG-88 Break-Action Shotgun",
          title: "SG-88 Break-Action Shotgun",
          anchor: null,
        },
        subcategory: null,
      }),
      expect.objectContaining({
        name: "CQC-72 Entrenchment Tool",
        page: {
          label: "CQC-72 Entrenchment Tool",
          title: "CQC-72 Entrenchment Tool",
          anchor: null,
        },
        subcategory: null,
      }),
    ]);
  });

  it("names subcategories by tab label, telling the three Special tabs apart by parent", () => {
    expect(rows[0]).toEqual({
      name: "AR-23 Liberator",
      page: { label: "AR-23 Liberator", title: "AR-23 Liberator", anchor: null },
      category: "Primary",
      subcategory: "Assault Rifle",
      image: {
        file: "AR-23_Liberator_Primary_Render.png",
        src: "/images/AR-23_Liberator_Primary_Render.png?97e7bb",
      },
    });
    const special = (name: string) => rows.find((row) => row.name === name);
    expect(special("JAR-5 Dominator")).toMatchObject({
      category: "Primary",
      subcategory: "Special",
    });
    expect(special("LAS-7 Dagger")).toMatchObject({
      category: "Secondary",
      subcategory: "Special",
    });
    expect(special("G-3 Smoke")).toMatchObject({ category: "Throwable", subcategory: "Special" });
  });

  it("fails loudly when the layout changes", () => {
    const parse = (html: string) => () => parseWeaponsIndex(html, { url: index.url });
    expect(parse(article("<p>gone</p>"))).toThrow("tabber panel Primary");
    expect(
      parse(index.html.replaceAll('aria-controls="Throwable-0"', 'aria-controls="x"')),
    ).toThrow(ParseError);
    expect(parse(index.html.replaceAll('aria-controls="Civilian-0"', 'aria-controls="x"'))).toThrow(
      "tabber panel Civilian",
    );
  });
});

describe("weapon-page parser", async () => {
  const load = async (title: string) => {
    const page = await fixture(title);
    return parseWeaponPage(page.html, { url: page.url });
  };
  const liberator = await load("AR-23 Liberator");

  it("reads the AR-23 Liberator page", async () => {
    await expect(json(liberator)).toMatchFileSnapshot("./__snapshots__/weapon-page.ar-23.json");
    expect(liberator).toMatchObject({
      title: "AR-23 Liberator",
      name: "AR-23 Liberator",
      container: "weapon",
      lead: "The AR-23 Liberator is a Primary Assault Rifle, available for all Helldivers.",
      image: { file: "AR-23_Liberator_Primary_Render.png" },
      source: { label: "Starter Equipment", link: null, pageMarker: null },
      cost: null,
      procurement: [],
    });
    expect(liberator.infobox.find((row) => row.key === "weapon_traits")).toEqual({
      key: "weapon_traits",
      label: "Traits",
      text: "Light Armor Penetrating",
      lines: ["Light Armor Penetrating"],
      links: [
        {
          label: "Light Armor Penetrating",
          title: "Equipment Traits",
          anchor: "Light_Armor_Penetrating",
        },
      ],
    });
  });

  it("reads stat tables as sections, with attack rows pointing at their tables", () => {
    expect(liberator.tables.map(({ kind, id, title }) => ({ kind, id, title }))).toEqual([
      { kind: "weapon", id: null, title: "AR-23 LIBERATOR" },
      {
        kind: "projectile",
        id: "55x50mm_FULL_METAL_JACKET_P",
        title: "5.5x50mm FULL METAL JACKET P",
      },
    ]);
    const [weapon, projectile] = liberator.tables;
    expect(weapon?.sections.map((section) => section.title)).toEqual([null, "Attacks"]);
    expect(weapon?.sections[1]?.rows).toEqual([
      {
        label: "5.5x50mm FULL METAL JACKET P",
        target: "55x50mm_FULL_METAL_JACKET_P",
        text: "Projectile",
        lines: ["Projectile"],
      },
    ]);
    expect(projectile?.sections.map((section) => section.title)).toEqual([
      "Projectile",
      "Damage",
      "Penetration",
      "Special Effects",
    ]);
  });

  it("reads a warbond source with its page marker and cost", async () => {
    const oneTwo = await load("AR/GL-21 One-Two");
    expect(oneTwo.source).toEqual({
      label: "Python Commandos P1",
      link: {
        label: "Python Commandos",
        title: "Python Commandos Premium Warbond",
        anchor: "Page_1",
      },
      pageMarker: "Page 1",
    });
    expect(oneTwo.cost).toEqual({ text: "35 Medals", currency: "medals" });
    expect(oneTwo.tables[0]?.sections.map((section) => section.title)).toEqual([
      null,
      "Underbarrel AR/GL-21 ONE-TWO 0",
    ]);
  });

  it("reads a stats table without a title row", async () => {
    const mine = await load("G/40-K Melta Mine");
    expect(mine.container).toBe("throwable");
    expect(mine.tables[0]).toMatchObject({ kind: "weapon", title: null });
    expect(mine.tables[0]?.sections.map((section) => section.title)).toEqual([null, "Attacks"]);
  });

  it("keeps Procurement links for pages without a Source row", async () => {
    const shovel = await load("CQC-73 Entrenchment Tool");
    expect(shovel).toMatchObject({
      title: "CQC-73 Entrenchment Tool",
      name: "Entrenchment Tool",
      source: null,
    });
    expect(shovel.procurement[0]).toEqual({
      label: "Entrenched Division Premium Warbond",
      title: "Entrenched Division Premium Warbond",
      anchor: null,
    });
  });

  it("fails without an infobox", () => {
    expect(() => parseWeaponPage(article("<p>x</p>"), { url: "page" })).toThrow(
      "expected 1 infobox",
    );
  });
});

describe("warbond item lookup", async () => {
  const page = await fixture("Castellan’s Creed Legendary Warbond");
  const warbond = parseWarbondPage(page.html, { url: page.url });

  it("finds an item by link title with any wiki type", () => {
    expect(findItem(warbond, "P/40-K Bolt Pistol", null)).toEqual({
      page: 2,
      item: {
        name: "P/40-K Bolt Pistol",
        link: { label: "P/40-K Bolt Pistol", title: "P/40-K Bolt Pistol", anchor: null },
        wikiType: "Pistol",
        cost: { text: "50", currency: "medals" },
      },
    });
    expect(findItem(warbond, "P/40-K Bolt Pistol", "Throwable")).toBeNull();
    expect(findItem(warbond, "AR-23 Liberator", null)).toBeNull();
  });
});
