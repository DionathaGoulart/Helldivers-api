import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
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

  it("reads the new acquisition cells on Page 1", () => {
    const $ = cheerio.load(page.html);
    const panel = $("#Page_1-0");
    panel.find(".warbond-cell").remove();
    panel.append(`<div class="hd2-acq-container">
      <div class="hd2-acq-cell hd2-acq-crop-helmet"><div class="hd2-acq-cost"><img src="/images/Super_Credit.svg"><span class="hd2-cost-value">125</span></div><div class="hd2-acq-image"><a href="/wiki/SS-500_Pale_Prosecutor" title="SS-500 Pale Prosecutor"><img alt="SS-500 Pale Prosecutor Helmet Render.png"></a></div></div>
      <div class="hd2-acq-cell hd2-acq-crop-card"><div class="hd2-acq-cost"><img src="/images/Super_Credit.svg"><span class="hd2-cost-value">35</span></div><div class="hd2-acq-image"><a href="/wiki/Arctic_Decree" title="Arctic Decree"><img alt="Arctic Decree Player Card Icon.png"></a></div></div>
      <div class="hd2-acq-cell hd2-acq-crop-cape"><div class="hd2-acq-cost"><img src="/images/Super_Credit.svg"><span class="hd2-cost-value">100</span></div><div class="hd2-acq-image"><a href="/wiki/Arctic_Decree" title="Arctic Decree"><img alt="Arctic Decree Cape Render.png"></a></div></div>
      <div class="hd2-acq-cell hd2-acq-crop-armor"><div class="hd2-acq-cost"><img src="/images/Super_Credit.svg"><span class="hd2-cost-value">250</span></div><div class="hd2-acq-image"><a href="/wiki/SS-500_Pale_Prosecutor" title="SS-500 Pale Prosecutor"><img alt="SS-500 Pale Prosecutor Armor Render.png"></a></div></div>
    </div>`);
    const current = parseSuperstore($.html(), { url: page.url });
    expect(current.pages[0]?.items).toEqual([
      {
        name: "SS-500 Pale Prosecutor",
        type: "Helmet",
        link: { label: "SS-500 Pale Prosecutor", title: "SS-500 Pale Prosecutor", anchor: null },
        cost: { text: "125", currency: "super_credits" },
      },
      {
        name: "Arctic Decree",
        type: "PlayerCard",
        link: { label: "Arctic Decree", title: "Arctic Decree", anchor: null },
        cost: { text: "35", currency: "super_credits" },
      },
      {
        name: "Arctic Decree",
        type: "Cape",
        link: { label: "Arctic Decree", title: "Arctic Decree", anchor: null },
        cost: { text: "100", currency: "super_credits" },
      },
      {
        name: "SS-500 Pale Prosecutor",
        type: "Armor",
        link: { label: "SS-500 Pale Prosecutor", title: "SS-500 Pale Prosecutor", anchor: null },
        cost: { text: "250", currency: "super_credits" },
      },
    ]);
    expect(current.pages).toHaveLength(25);

    panel.find(".hd2-acq-cell").first().find(".hd2-cost-value").remove();
    expect(() => parseSuperstore($.html(), { url: page.url })).toThrow(
      "unexpected acquisition cell",
    );
    panel
      .find(".hd2-acq-cell")
      .first()
      .find(".hd2-acq-cost")
      .append('<span class="hd2-cost-value">unreadable</span>');
    expect(() => parseSuperstore($.html(), { url: page.url })).toThrow(
      "unexpected acquisition cell",
    );
    panel.find(".hd2-acq-container").remove();
    expect(() => parseSuperstore($.html(), { url: page.url })).toThrow();
  });

  it("reads live acquisition cells and rejects unknown or conflicting crop classes", () => {
    const liveCells = readFileSync(
      join(import.meta.dirname, "../fixtures/superstore-acquisition-cells.html"),
      "utf8",
    );
    const $ = cheerio.load(page.html);
    const panel = $("#Page_2-0");
    panel.append(liveCells);

    const items = parseSuperstore($.html(), { url: page.url }).pages[1]?.items;
    expect(items?.slice(-6)).toMatchObject([
      { name: "LAS-12 Sai", type: null, cost: { text: "400", currency: "super_credits" } },
      { type: null, cost: { currency: "super_credits" } }, // secondary weapon
      { type: "Helmet" },
      { type: "Armor" },
      { type: "Emote" },
      { type: null }, // throwable
    ]);

    const unknown = liveCells.replace("hd2-acq-crop-primary", "hd2-acq-crop-unknown");
    const unknownPage = cheerio.load(page.html);
    unknownPage("#Page_2-0").append(unknown);
    expect(() => parseSuperstore(unknownPage.html(), { url: page.url })).toThrow(
      "unrecognized item type",
    );
    const conflicting = liveCells.replace(
      "hd2-acq-crop-primary",
      "hd2-acq-crop-primary hd2-acq-crop-secondary",
    );
    const conflictingPage = cheerio.load(page.html);
    conflictingPage("#Page_2-0").append(conflicting);
    expect(() => parseSuperstore(conflictingPage.html(), { url: page.url })).toThrow(
      "unrecognized item type",
    );
  });
});
