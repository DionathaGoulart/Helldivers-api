import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { COSMETICS_INDEX, parseCosmeticsIndex } from "../../src/parsers/cosmetics-index.ts";
import { parsePatternPage } from "../../src/parsers/pattern-page.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("cosmetics-index parser", async () => {
  const index = await fixture(COSMETICS_INDEX);
  const cosmetics = parseCosmeticsIndex(index.html, { url: index.url });

  it("reads the player card grid and the emote, pattern and title tables of the fixture", async () => {
    const { playerCards, emotes, vehiclePatterns, weaponPatterns, rankTitles, acquirableTitles } =
      cosmetics;
    expect([
      playerCards.length,
      emotes.length,
      vehiclePatterns.length,
      weaponPatterns.length,
      rankTitles.length,
      acquirableTitles.length,
    ]).toEqual([74, 48, 15, 12, 36, 20]);
    expect(cosmetics.title).toBe("Cosmetics");
    await expect(json(cosmetics)).toMatchFileSnapshot("./__snapshots__/cosmetics-index.json");
  });

  it("keeps emote rows as text, flags and `/` costs included", () => {
    const row = (name: string) => cosmetics.emotes.find((emote) => emote.name === name);
    expect(row("Casual Salute")).toMatchObject({
      cost: { text: "/", currency: null },
      source: { label: "Starter Equipment", link: null, pageMarker: null },
      emote: "✅",
      victoryPose: "❌",
    });
    expect(row("Clapping")).toEqual({
      name: "Clapping",
      page: { label: "Clapping", title: "Clapping", anchor: null },
      cost: { text: "1", currency: "medals" },
      source: {
        label: "Helldivers Mobilize",
        link: {
          label: "Helldivers Mobilize",
          title: "Helldivers Mobilize Warbond",
          anchor: "Page_1",
        },
        pageMarker: null,
      },
      emote: "❌",
      victoryPose: "✅",
      icon: {
        file: "Clapping_Victory_Pose_Icon.png",
        src: "/images/thumb/Clapping_Victory_Pose_Icon.png/128px-Clapping_Victory_Pose_Icon.png?2421fa",
      },
    });
  });

  it("lines vehicle pattern costs up with their columns, colspan rows included", () => {
    const [standard] = cosmetics.vehiclePatterns;
    const empty = { text: "", currency: null };
    expect(standard).toMatchObject({
      name: "Standard",
      page: { title: "Standard Pattern" },
      costs: { shuttle: empty, hellpod: empty, exosuit: empty, vehicle: empty },
      source: { label: "Starter Equipment" },
    });
    expect(cosmetics.vehiclePatterns.find((row) => row.name === "Castellans Green")).toMatchObject({
      costs: {
        shuttle: { text: "50", currency: "medals" },
        hellpod: { text: "20", currency: "medals" },
        exosuit: { text: "50", currency: "medals" },
        vehicle: { text: "55", currency: "medals" },
      },
      source: {
        label: "Castellan's Creed",
        link: { title: "Castellan’s Creed Legendary Warbond" },
      },
    });
  });

  it("reads weapon patterns from their slip icon and rows without a Pattern Icon cell", () => {
    expect(cosmetics.weaponPatterns[0]).toMatchObject({
      name: "Default",
      cost: { text: "0", currency: "requisition" },
      levelNeeded: "0",
    });
    expect(cosmetics.weaponPatterns.find((row) => row.name === "Arctic")).toEqual({
      name: "Arctic",
      cost: { text: "3,000", currency: "requisition" },
      levelNeeded: "5",
      image: {
        file: "AR-23P_Liberator_Penetrator_Arctic_Pattern_Render.png",
        src: "/images/thumb/AR-23P_Liberator_Penetrator_Arctic_Pattern_Render.png/250px-AR-23P_Liberator_Penetrator_Arctic_Pattern_Render.png?16b0e7",
      },
    });
  });

  it("tells the rank and acquirable title tables apart by their columns", () => {
    expect(cosmetics.rankTitles[2]).toMatchObject({
      name: "Sergeant",
      page: { title: "Sergeant" },
      level: "10",
    });
    const title = (name: string) => cosmetics.acquirableTitles.find((row) => row.name === name);
    expect(title("Super Citizen")).toMatchObject({
      source: { label: "Super Citizen Edition" },
      cost: { text: "💲20", currency: "usd" },
    });
    expect(title("[Redacted]")).toMatchObject({ page: { title: "Redacted" } });
    expect(title("Viper Commando")).toMatchObject({
      source: { link: { title: "Viper Commandos Premium Warbond", anchor: "Page_3" } },
      cost: { text: "20", currency: "medals" },
    });
  });

  it("fails loudly when the layout changes", () => {
    const parse = (html: string) => () => parseCosmeticsIndex(html, { url: index.url });
    expect(parse(article("<p>gone</p>"))).toThrow(ParseError);
    expect(parse(index.html.replaceAll(">Player Cards<", ">Cards<"))).toThrow(
      'details "Player Cards"',
    );
    expect(parse(index.html.replaceAll(">Victory Pose\n<", ">Pose\n<"))).toThrow(
      'missing column "Victory Pose"',
    );
    expect(parse(index.html.replaceAll('aria-controls="Weapon-0"', 'aria-controls="x"'))).toThrow(
      "tabber panel Weapon",
    );
    expect(parse(index.html.replaceAll(">Level Earned\n<", ">Level\n<"))).toThrow(
      'with "Level Earned"',
    );
  });
});

describe("pattern-page parser", async () => {
  const load = async (title: string) => {
    const page = await fixture(title);
    return parsePatternPage(page.html, { url: page.url });
  };

  it("reads one variant per vehicle tab, FRV as the vehicle target", async () => {
    const green = await load("Castellans Green Pattern");
    expect(green).toMatchObject({
      title: "Castellans Green Pattern",
      name: "Castellans Green",
      lead: "Castellans Green patterns are selectable wraps for your various vehicles.",
    });
    expect(green.categories).toContain("Stubs");
    expect(green.variants.map(({ tab, target }) => [tab, target])).toEqual([
      ["Shuttle", "shuttle"],
      ["Hellpod", "hellpod"],
      ["Exosuit", "exosuit"],
      ["FRV", "vehicle"],
    ]);
    // The wiki's Exosuit tab says page 1; the warbond table lists it on page 3 (rule 10).
    expect(green.variants[2]).toEqual({
      tab: "Exosuit",
      target: "exosuit",
      source: {
        label: "Castellan’s Creed",
        link: {
          label: "Castellan’s Creed",
          title: "Castellan’s Creed Legendary Warbond",
          anchor: "Page_1",
        },
        pageMarker: null,
      },
      cost: { text: "50 Medals", currency: "medals" },
      image: {
        file: "Castellans_Green_Exosuit_Pattern_Icon.png",
        src: "/images/thumb/Castellans_Green_Exosuit_Pattern_Icon.png/600px-Castellans_Green_Exosuit_Pattern_Icon.png?47b0f1",
      },
    });
  });

  it("skips the Tank tab of the Standard pattern and fails on another tab", async () => {
    const standard = await load("Standard Pattern");
    expect(standard.variants.map((variant) => variant.target)).toEqual([
      "shuttle",
      "hellpod",
      "exosuit",
      "vehicle",
    ]);
    expect(standard.variants[0]?.cost).toEqual({ text: "Free", currency: null });

    const page = await fixture("Standard Pattern");
    const renamed = page.html.replaceAll('data-druid-tab-key="Tank"', 'data-druid-tab-key="Boat"');
    expect(() => parsePatternPage(renamed, { url: page.url })).toThrow(
      'unknown pattern tab "Boat"',
    );
  });
});
