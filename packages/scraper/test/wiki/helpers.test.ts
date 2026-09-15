import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { detectCurrency } from "../../src/wiki/currency.ts";
import { linesOf, loadHtml, textOf } from "../../src/wiki/html.ts";
import { fileFromSrc, firstArticleLink, firstImage } from "../../src/wiki/links.ts";
import {
  flagsFromCategories,
  readCanonicalTitle,
  readCategories,
  readLead,
} from "../../src/wiki/page.ts";
import { findInSection, readSections } from "../../src/wiki/sections.ts";
import { columnIndexes, readWikitable } from "../../src/wiki/wikitable.ts";
import { article } from "../fixtures.ts";

describe("text", () => {
  const $ = loadHtml(
    '<p id="p">Increases <b>reload</b>\n speed.<sup class="reference">[1]</sup><br>Slightly  more<br><br>ergonomics.</p>',
  );

  it("collapses whitespace and drops references", () => {
    expect(textOf($("#p"))).toBe("Increases reload speed. Slightly more ergonomics.");
  });

  it("splits lines on <br>", () => {
    expect(linesOf($("#p"))).toEqual(["Increases reload speed.", "Slightly more", "ergonomics."]);
  });
});

describe("readWikitable", () => {
  const $ = loadHtml(`<table class="wikitable" id="t"><tbody>
    <tr><th>Name</th><th>Cost </th></tr>
    <tr><td>A</td><td>1</td></tr>
    <tr><th colspan="2">Attacks</th></tr>
    <tr><td>B <table><tr><td>nested</td><td>x</td></tr></table></td><td>2</td></tr>
  </tbody></table>`);
  const table = readWikitable($, $("#t"));

  it("reads headers, rows and section rows, skipping nested tables", () => {
    expect(table.headers).toEqual(["Name", "Cost"]);
    expect(table.rows.map((row) => [row.section, row.cells.length])).toEqual([
      [null, 2],
      ["Attacks", 2],
    ]);
  });

  it("finds columns by name and fails on a missing one", () => {
    expect(columnIndexes(table, ["Cost", "Name"], "page", "#t")).toEqual({ Cost: 1, Name: 0 });
    expect(() => columnIndexes(table, ["Price"], "page", "#t")).toThrow(ParseError);
  });
});

describe("detectCurrency", () => {
  it.each([
    [
      '<span class="Currencyicons"><span class="Medalicon"><img src="/images/Medal.svg?1"></span> 15</span>',
      "medals",
    ],
    ['<img src="/images/thumb/Super_Credit.png/51px-Super_Credit.png?2"> 100', "super_credits"],
    ['<span class="explain" title="USD">💲</span>20', "usd"],
    ["4000 Requisition Slips", "requisition"],
    ["Free", null],
  ])("%s → %s", (cell, currency) => {
    const $ = loadHtml(`<div id="c">${cell}</div>`);
    expect(detectCurrency($("#c"))).toBe(currency);
  });
});

describe("links and images", () => {
  const $ = loadHtml(
    '<div id="c"><a href="/wiki/File:Icon.svg"><img src="/images/Icon.svg?7aa15a"></a> <a href="/wiki/Helldivers_Mobilize_Warbond#Page_3">Helldivers Mobilize</a></div>',
  );

  it("skips file links", () => {
    expect(firstArticleLink($("#c"))).toEqual({
      label: "Helldivers Mobilize",
      title: "Helldivers Mobilize Warbond",
      anchor: "Page_3",
    });
  });

  it("reads image files from direct and thumbnail sources", () => {
    expect(firstImage($("#c"))).toEqual({ file: "Icon.svg", src: "/images/Icon.svg?7aa15a" });
    expect(fileFromSrc("/images/thumb/Super_Credit.png/51px-Super_Credit.png?178851")).toBe(
      "Super_Credit.png",
    );
    expect(fileFromSrc("/wiki/File:Icon.svg")).toBeNull();
  });
});

describe("page facts", () => {
  const $ = loadHtml(
    article(
      '<div class="breadcrumb"><p>not the lead</p></div><p><br></p><p><b>True Grit</b> is a passive.</p><p>Second.</p>',
      '<link rel="canonical" href="https://helldivers.wiki.gg/wiki/True_Grit">',
    ) +
      '<div id="catlinks"><div class="mw-normal-catlinks"><ul><li><a>Armor Passives</a></li><li><a>Potentially Outdated Pages</a></li></ul></div><div class="mw-hidden-catlinks"><ul><li><a>Pages with broken file links</a></li></ul></div></div>',
  );

  it("reads canonical title, lead and categories", () => {
    expect(readCanonicalTitle($, "page")).toBe("True Grit");
    expect(readLead($)).toBe("True Grit is a passive.");
    expect(readCategories($)).toEqual([
      "Armor Passives",
      "Potentially Outdated Pages",
      "Pages with broken file links",
    ]);
  });

  it("maps maintenance categories to flags", () => {
    expect(flagsFromCategories(readCategories($))).toEqual([
      "potentially_outdated",
      "broken_file_links",
    ]);
    expect(flagsFromCategories(["Boosters", "Pages With Empty Sections"])).toEqual([]);
  });

  it("fails without a canonical link", () => {
    expect(() => readCanonicalTitle(loadHtml(article("<p>x</p>")), "page")).toThrow(ParseError);
  });
});

describe("readSections", () => {
  const $ = loadHtml(
    article(`
      <h2><span class="mw-headline" id="Contents">Contents</span></h2>
      <h3><span class="mw-headline" id="Page_1">Page 1</span></h3>
      <div class="mw-collapsible"><table class="wikitable"><tr><th>A</th></tr></table></div>
      <h4>Notes</h4><p>note</p>
      <div class="mw-heading mw-heading3"><h3 id="Page_2">Page 2</h3></div>
      <table class="wikitable"><tr><th>B</th></tr></table>
      <h2><span class="mw-headline" id="Media">Media</span></h2>
      <p>after</p>`),
  );

  it("handles both heading markups and stops at a higher level", () => {
    const sections = readSections($, 3);
    expect(sections.map(({ id, title, level }) => ({ id, title, level }))).toEqual([
      { id: "Page_1", title: "Page 1", level: 3 },
      { id: "Page_2", title: "Page 2", level: 3 },
    ]);
    expect(sections.map((section) => findInSection(section, "table.wikitable").length)).toEqual([
      1, 1,
    ]);
    expect(sections[0]?.content.text()).toContain("note");
    expect(sections[1]?.content.text()).not.toContain("after");
  });
});
