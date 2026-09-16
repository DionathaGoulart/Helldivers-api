import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { findItem, findItemPage, parseWarbondPage } from "../../src/parsers/warbond-page.ts";
import { parseWarbondsIndex, WARBONDS_INDEX } from "../../src/parsers/warbonds-index.ts";
import { article, fixture } from "../fixtures.ts";

describe("warbonds-index parser", async () => {
  const index = await fixture(WARBONDS_INDEX);
  const rows = parseWarbondsIndex(index.html, { url: index.url });

  it("reads each gallery box once, typed by its section", () => {
    const byType = (type: string) => rows.filter((row) => row.type === type).length;
    expect([byType("Standard"), byType("Premium"), byType("Legendary")]).toEqual([1, 21, 3]);
    expect(new Set(rows.map((row) => row.page.title)).size).toBe(25);
    expect(rows.at(-1)).toEqual({
      name: "Castellan's Creed",
      page: {
        label: "Castellan's Creed",
        title: "Castellan's Creed Legendary Warbond",
        anchor: null,
      },
      type: "Legendary",
    });
  });

  it("keeps links through redirects for the warbond page to resolve", () => {
    expect(rows.find((row) => row.name === "Democratic Detonation")?.page.title).toBe(
      "Democratic Detonation",
    );
    expect(rows[0]?.page.title).toBe("Helldivers Mobilize! Warbond");
  });

  it("fails loudly when a section or its gallery is gone", () => {
    const noLegendary = index.html.replace('id="Legendary"', 'id="Mythic"');
    expect(() => parseWarbondsIndex(noLegendary, { url: index.url })).toThrow(
      "h3#Legendary: expected 1 section, found 0",
    );
    const empty = article('<h3 id="Standard">Standard</h3><h3 id="Premium">Premium</h3>');
    expect(() => parseWarbondsIndex(empty, { url: index.url })).toThrow(ParseError);
  });
});

describe("warbond-page parser (infobox)", () => {
  it("reads the infobox, lead and categories", async () => {
    const page = await fixture("Castellan's Creed Legendary Warbond");
    const { pages, categories, ...creed } = parseWarbondPage(page.html, { url: page.url });
    expect(creed).toEqual({
      title: "Castellan's Creed Legendary Warbond",
      name: "Castellan's Creed",
      lead: "Castellan's Creed is a Legendary Warbond available for 1,500 Super Credits in the Warbonds tab of the Acquisition Center.",
      image: {
        file: "Castellan's_Creed_Legendary_Warbond_Cover.png",
        src: "/images/thumb/Castellan%27s_Creed_Legendary_Warbond_Cover.png/600px-Castellan%27s_Creed_Legendary_Warbond_Cover.png?661a59",
      },
      releaseDate: "August 12th, 2026",
      cost: { text: "1500 Super Credits", currency: "super_credits" },
      creditsClaimable: { text: "None", currency: null },
      medalsAllPages: { text: "210 Medals", currency: "medals" },
      medalsAllItems: { text: "657 Medals", currency: "medals" },
    });
    expect(categories).toContain("Legendary Warbonds");
    expect(pages.map((listed) => listed.items.length)).toEqual([6, 7, 4]);
  });

  it("reads a free warbond and one without medal totals yet", async () => {
    const mobilizePage = await fixture("Helldivers Mobilize! Warbond");
    expect(parseWarbondPage(mobilizePage.html, { url: mobilizePage.url })).toMatchObject({
      title: "Helldivers Mobilize Warbond",
      name: "Helldivers Mobilize!",
      cost: { text: "Free", currency: null },
      creditsClaimable: { text: "750 Super Credits", currency: "super_credits" },
    });
    const ironcladPage = await fixture("Ironclad Democracy Premium Warbond");
    expect(parseWarbondPage(ironcladPage.html, { url: ironcladPage.url })).toMatchObject({
      releaseDate: "September 22nd, 2026",
      medalsAllPages: null,
      medalsAllItems: null,
    });
  });

  it("fails loudly without an infobox or a release date", async () => {
    const page = await fixture("Castellan's Creed Legendary Warbond");
    const undated = page.html.replace("druid-row-date", "druid-row-released");
    expect(() => parseWarbondPage(undated, { url: page.url })).toThrow("releaseDate");
    expect(() => parseWarbondPage(article("<p>gone</p>"), { url: page.url })).toThrow(
      "expected 1 infobox, found 0",
    );
  });
});

describe("warbond-page parser (page tables)", async () => {
  const mobilizePage = await fixture("Helldivers Mobilize Warbond");
  const mobilize = parseWarbondPage(mobilizePage.html, { url: mobilizePage.url });
  const redactedPage = await fixture("Redacted Regiment Premium Warbond");
  const redacted = parseWarbondPage(redactedPage.html, { url: redactedPage.url });

  it("reads every page table in order", () => {
    expect(mobilize.title).toBe("Helldivers Mobilize Warbond");
    expect(mobilize.pages.map((page) => [page.number, page.items.length])).toEqual(
      Array.from({ length: 10 }, (_, i) => [i + 1, 8]),
    );
    expect(redacted.pages.map((page) => [page.number, page.items.length])).toEqual([
      [1, 7],
      [2, 6],
      [3, 6],
    ]);
  });

  it("reads item name, link, wiki type and icon-aware cost", () => {
    expect(mobilize.pages[2]?.items.slice(0, 2)).toEqual([
      {
        name: "100 Super Credits",
        link: { label: "Super Credits", title: "Super Credits", anchor: null },
        wikiType: "Currency",
        cost: { text: "3", currency: "medals" },
      },
      {
        name: "Hellpod Space Optimization",
        link: {
          label: "Hellpod Space Optimization",
          title: "Hellpod Space Optimization",
          anchor: null,
        },
        wikiType: "Booster",
        cost: { text: "15", currency: "medals" },
      },
    ]);
  });

  it("finds the page that lists an item", () => {
    expect(findItemPage(redacted, "Concealed Insertion", "Booster")).toBe(3);
    expect(findItemPage(mobilize, "Hellpod Space Optimization", "Booster")).toBe(3);
    expect(findItemPage(redacted, "Concealed Insertion", "Cape")).toBeNull();
    expect(findItemPage(redacted, "Nope", "Booster")).toBeNull();
  });

  it("tells rows linking the same page apart by name (rule 10 pattern variants)", async () => {
    const page = await fixture("Castellan’s Creed Legendary Warbond");
    const creed = parseWarbondPage(page.html, { url: page.url });
    const title = "Castellans Green Pattern";
    expect(findItem(creed, title, "Pattern")).toBeNull(); // four rows on three pages
    expect(findItemPage(creed, title, "Pattern", "Castellans Green Shuttle")).toBe(2);
    expect(findItem(creed, title, "Pattern", "Castellans  Green Exosuit")).toMatchObject({
      page: 3,
      item: { name: "Castellans Green Exosuit", cost: { text: "50", currency: "medals" } },
    });
    expect(findItem(creed, title, "Pattern", "Castellans Green Tank")).toBeNull();
    // Title rows link nothing: only a name finds them.
    expect(findItemPage(creed, "Still Standing", "Title")).toBeNull();
    expect(findItemPage(creed, "Still Standing", "Title", "Still Standing")).toBe(3);
  });
});
