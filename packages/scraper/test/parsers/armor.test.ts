import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../../src/parsers/armor-index.ts";
import { armoryTab, parseArmorPage } from "../../src/parsers/armor-page.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("armor-index parser", async () => {
  const index = await fixture(ARMOR_INDEX);
  const { armors, helmets, capes } = parseArmorIndex(index.html, { url: index.url });
  const count = (weight: string) => armors.filter((row) => row.weight === weight).length;

  it("reads the weight tables and the helmet and cape grids of the fixture", async () => {
    expect([count("Light"), count("Medium"), count("Heavy")]).toEqual([30, 49, 30]);
    expect([helmets.length, capes.length]).toEqual([110, 89]);
    await expect(json({ armors, helmets, capes })).toMatchFileSnapshot(
      "./__snapshots__/armor-index.json",
    );
  });

  it("keeps table cells as text, zero padding included", () => {
    expect(armors[0]).toEqual({
      name: "SC-37 Legionnaire",
      page: { label: "SC-37 Legionnaire", title: "SC-37 Legionnaire", anchor: null },
      weight: "Light",
      armor: "050",
      speed: "550",
      stamina: "125",
      passive: { label: "Servo-Assisted", title: "Servo-Assisted", anchor: null },
      cost: { text: "150", currency: "super_credits" },
      source: {
        label: "Superstore",
        link: { label: "Superstore", title: "Superstore", anchor: null },
        pageMarker: null,
      },
      icon: {
        file: "SC-37_Legionnaire_Armor_Render.png",
        src: "/images/thumb/SC-37_Legionnaire_Armor_Render.png/123px-SC-37_Legionnaire_Armor_Render.png?e35814",
        width: 1024,
        height: 1024,
      },
    });
  });

  it("lists the standalone helmet and every armor page in the helmet grid", () => {
    const armorPages = new Set(armors.map((row) => row.page.title));
    expect(helmets.filter((box) => !armorPages.has(box.page.title)).map((box) => box.name)).toEqual(
      ["IX-Voidwalker"],
    );
    expect(helmets.find((box) => box.name === "TG-8 Sharpshooter")).toMatchObject({
      source: {
        label: "Castellan's Creed P1",
        link: { title: "Castellan's Creed Legendary Warbond", anchor: "Page_1" },
        pageMarker: "Page 1",
      },
      cost: { text: "30", currency: "medals" },
    });
    expect(capes.find((box) => box.name === "Camo Cloak")).toMatchObject({
      source: { label: "Castellan’s Creed", pageMarker: null },
      cost: { text: "8", currency: "medals" },
    });
  });

  it("fails loudly when the layout changes", () => {
    const parse = (html: string) => () => parseArmorIndex(html, { url: index.url });
    expect(parse(article("<p>gone</p>"))).toThrow("tabber panel Armor › Light");
    expect(parse(index.html.replaceAll(">Stamina<", ">Stam<"))).toThrow('missing column "Stamina"');
    expect(parse(index.html.replaceAll('aria-controls="Cape-0"', 'aria-controls="x"'))).toThrow(
      ParseError,
    );
  });
});

describe("armor-page parser", async () => {
  const load = async (title: string) => {
    const page = await fixture(title);
    return parseArmorPage(page.html, { url: page.url });
  };

  it("splits an armor page into its Body Armor and Helmet tabs", async () => {
    const sharpshooter = await load("TG-8 Sharpshooter");
    const castellans = {
      label: "Castellan's Creed P1",
      link: {
        label: "Castellan's Creed",
        title: "Castellan's Creed Legendary Warbond",
        anchor: "Page_1",
      },
      pageMarker: "Page 1",
    };
    expect(sharpshooter).toMatchObject({
      title: "TG-8 Sharpshooter",
      name: "TG-8 Sharpshooter",
      lead: "TG-8 Sharpshooter is a set of medium armor in Helldivers 2.",
      armoryDescription:
        '"Where lesser soldiers break, Helldivers obey. When Tyranny\'s horrors swarm, Helldivers obey. When death is certain, and hope and sense have fled, Helldivers obey." -- Last Lord Governor of Chara.',
    });
    expect(sharpshooter.tabs.map((tab) => tab.name)).toEqual(["Body Armor", "Helmet"]);
    const [body, helmet] = sharpshooter.tabs;
    expect(body?.rows.map((row) => `${row.key}=${row.text}`)).toEqual([
      "type=Medium",
      "armor=100",
      "speed=500",
      "stam_regen=100",
      "passive=True Grit",
      "source=Castellan's Creed P1",
      "cost=45",
    ]);
    expect(body?.rows.find((row) => row.key === "passive")?.links).toEqual([
      { label: "True Grit", title: "True Grit", anchor: null },
    ]);
    expect(body).toMatchObject({
      source: castellans,
      cost: { text: "45", currency: "medals" },
      image: { file: "TG-8_Sharpshooter_Armor_Render.png" },
    });
    expect(helmet).toEqual({
      name: "Helmet",
      rows: [
        expect.objectContaining({ key: "source" }),
        expect.objectContaining({ key: "cost", text: "30" }),
      ],
      source: castellans,
      cost: { text: "30", currency: "medals" },
      image: {
        file: "TG-8_Sharpshooter_Helmet_Render.png",
        src: "/images/TG-8_Sharpshooter_Helmet_Render.png?a9029b",
        width: 1024,
        height: 1024,
      },
    });
  });

  it("applies untabbed rows to every tab of a cape page", async () => {
    const resolve = await load("City Fighter's Resolve");
    expect(resolve.tabs.map((tab) => [tab.name, tab.source?.label, tab.cost?.text])).toEqual([
      ["Cape", "Castellan’s Creed", "25"],
      ["Player Card", "Castellan’s Creed", "7"],
    ]);
    expect(resolve.armoryDescription).toMatch(/^The Helldivers are all that stand between/);
    expect(armoryTab(resolve, "Player Card")?.image?.file).toBe(
      "City_Fighter's_Resolve_Player_Card.png",
    );
    expect(armoryTab(resolve, "Helmet")).toBeNull();
  });

  it("reads pages without tabs and standalone helmets", async () => {
    const foesmasher = await load("Foesmasher");
    expect(foesmasher.tabs).toEqual([
      {
        name: null,
        rows: [expect.objectContaining({ key: "source", text: "Starter Equipment" })],
        source: { label: "Starter Equipment", link: null, pageMarker: null },
        cost: null,
        image: {
          file: "Foesmasher_Cape_Render.png",
          src: "/images/thumb/Foesmasher_Cape_Render.png/600px-Foesmasher_Cape_Render.png?e9ed37",
          width: 1024,
          height: 1024,
        },
      },
    ]);
    expect(armoryTab(foesmasher, "Cape")).toBe(foesmasher.tabs[0]);

    const voidwalker = await load("IX-Voidwalker");
    expect(voidwalker.tabs.map((tab) => tab.name)).toEqual(["Helmet"]);
    expect(armoryTab(voidwalker, "Helmet")?.source?.label).toBe("Void Piercer");
    // One tab without a per-tab picture: the infobox picture is the helmet's.
    expect(armoryTab(voidwalker, "Helmet")?.image).toEqual({
      file: "IX-Voidwalker_Helmet_Render.png",
      src: "/images/IX-Voidwalker_Helmet_Render.png?f39ffa",
      width: 1024,
      height: 1024,
    });
    expect(armoryTab(voidwalker, "Body Armor")).toBeNull();
    expect(voidwalker.armoryDescription).toMatch(/^A helmet worn by the pioneering Helldivers/);
  });

  it("fails without an infobox or without rows", () => {
    expect(() => parseArmorPage(article("<p>x</p>"), { url: "page" })).toThrow(
      "expected 1 infobox",
    );
    expect(() =>
      parseArmorPage(article('<div class="druid-infobox"><div class="druid-title">X</div></div>'), {
        url: "page",
      }),
    ).toThrow("no infobox rows");
  });
});
