import { describe, expect, it } from "vitest";
import { findItem, findItemPage, parseWarbondPage } from "../../src/parsers/warbond-page.ts";
import { fixture } from "../fixtures.ts";

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
