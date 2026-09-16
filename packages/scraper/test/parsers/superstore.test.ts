import { describe, expect, it } from "vitest";
import { parseSuperstore, SUPERSTORE } from "../../src/parsers/superstore.ts";
import { article, fixture } from "../fixtures.ts";

describe("superstore parser", async () => {
  const page = await fixture(SUPERSTORE);
  const store = parseSuperstore(page.html, { url: page.url });

  it("reads every stock tab with its items and release order set", () => {
    expect(store.pages.map((tab) => tab.number)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(store.pages.reduce((count, tab) => count + tab.items.length, 0)).toBe(109);
    expect(store.pages.every((tab) => tab.items.length === tab.set.items.length)).toBe(true);
  });

  it("reads cells from their title, link and SC price", () => {
    const third = store.pages[2];
    expect(third?.items.map(({ name, type, cost }) => [name, type, cost.text])).toEqual([
      ["RS-100 Sanctioner", "Helmet", "125"],
      ["RS-100 Sanctioner", "Armor", "250"],
      ["Gilded Quill", "PlayerCard", "35"],
      ["G-89 Smokescreen", null, "300"],
      ["Gilded Quill", "Cape", "100"],
    ]);
    expect(third?.items[3]).toEqual({
      name: "G-89 Smokescreen",
      type: null,
      link: { label: "G-89 Smokescreen", title: "G-89 Smokescreen", anchor: null },
      cost: { text: "300", currency: "super_credits" },
    });
  });

  it("reads the release order table: caption link, rows linked once, total", () => {
    expect(store.pages[2]?.set).toMatchObject({
      label: "Redacted Regiment",
      link: { title: "Redacted Regiment Premium Warbond" },
      items: [
        { text: "RS-100 Sanctioner Helmet", link: { title: "RS-100 Sanctioner" } },
        { text: "RS-100 Sanctioner Armor", link: null },
        { text: "Gilded Quill Player Card", link: { title: "Gilded Quill" } },
        { text: "Gilded Quill Cape", link: null },
        { text: "G-89 Smokescreen", cost: { text: "300", currency: "super_credits" } },
      ],
      total: { text: "810", currency: "super_credits" },
    });
    expect(store.pages[8]?.set).toMatchObject({ label: "War Horses", link: null });
  });

  it("fails loudly when the layout changes", () => {
    const renamed = page.html.replace('title="O-44 Bonded Pilot (Armor) (250 SC)"', 'title="O-44"');
    expect(() => parseSuperstore(renamed, { url: page.url })).toThrow('unexpected title "O-44"');
    expect(() => parseSuperstore(article("<p>gone</p>"), { url: page.url })).toThrow(
      "h2#Stock: expected 1 section, found 0",
    );
  });
});
