import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { detectCurrency } from "../../src/wiki/currency.ts";
import { druidData, readDruid } from "../../src/wiki/druid.ts";
import { linesOf, loadHtml, textOf } from "../../src/wiki/html.ts";
import { readItemBoxes } from "../../src/wiki/itemgrid.ts";
import { fileFromSrc, firstArticleLink, firstImage } from "../../src/wiki/links.ts";
import {
  flagsFromCategories,
  readCanonicalTitle,
  readCategories,
  readLead,
} from "../../src/wiki/page.ts";
import { findInSection, readSections } from "../../src/wiki/sections.ts";
import { readCodeArrows } from "../../src/wiki/stratagem-code.ts";
import { ownElements, readTabberPanels } from "../../src/wiki/tabber.ts";
import { columnIndexes, expandColspans, readWikitable } from "../../src/wiki/wikitable.ts";
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

  it("repeats colspan cells so they line up with the headers", () => {
    const $$ = loadHtml(`<table class="wikitable" id="s"><tbody>
      <tr><th>Icon</th><th>Shuttle</th><th>Hellpod</th><th>Acquisition</th></tr>
      <tr><td>i</td><td colspan="2"></td><td>Starter Equipment</td></tr>
    </tbody></table>`);
    const [row] = readWikitable($$, $$("#s")).rows;
    expect(row?.cells).toHaveLength(3);
    const expanded = row ? expandColspans(row) : null;
    expect(expanded?.cells.map((cell) => textOf(cell))).toEqual(["i", "", "", "Starter Equipment"]);
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
    [
      '<a title="Requisition Slips"><img alt="Requisition Slips" src="/images/Requisition_Slip.svg?b"></a> 3,000',
      "requisition",
    ],
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

  it("skips icon-only links to the article", () => {
    const panel = loadHtml(
      '<div id="h"><a href="/wiki/True_Grit"><img src="/images/True_Grit_Armor_Passive_Icon.svg?4e2218"></a> <a href="/wiki/True_Grit">True Grit</a></div>',
    );
    expect(firstArticleLink(panel("#h"))).toEqual({
      label: "True Grit",
      title: "True Grit",
      anchor: null,
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
    expect(flagsFromCategories(["Stubs", "Patterns"])).toEqual(["stub"]);
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

describe("readTabberPanels", () => {
  const tabber = (panels: [id: string, label: string, body: string][]) =>
    `<div class="tabber"><header class="tabber__header"><nav class="tabber__tabs">${panels
      .map(([id, label]) => `<a class="tabber__tab" aria-controls="${id}">${label}</a>`)
      .join("")}</nav></header><section class="tabber__section">${panels
      .map(([id, , body]) => `<article class="tabber__panel" id="${id}">${body}</article>`)
      .join("")}</section></div>`;
  const $ = loadHtml(
    article(
      tabber([
        ["Primary-0", "Primary", tabber([["Special-0", "Special", "<i>a</i><i>b</i>"]])],
        ["Secondary-0", "Secondary", `<i>own</i>${tabber([["Special-1", "Special", "<i>c</i>"]])}`],
      ]),
    ),
  );
  const panels = readTabberPanels($, $("#mw-content-text"));

  it("identifies panels by their chain of tab labels, not by id", () => {
    expect(panels.map(({ id, label, path }) => ({ id, label, path }))).toEqual([
      { id: "Primary-0", label: "Primary", path: ["Primary"] },
      { id: "Special-0", label: "Special", path: ["Primary", "Special"] },
      { id: "Secondary-0", label: "Secondary", path: ["Secondary"] },
      { id: "Special-1", label: "Special", path: ["Secondary", "Special"] },
    ]);
  });

  it("finds elements owned by a panel, not by its nested panels", () => {
    const text = (i: number) =>
      ownElements($, panels[i] as (typeof panels)[number], "i")
        .toArray()
        .map((element) => $(element).text());
    expect(text(0)).toEqual([]);
    expect(text(1)).toEqual(["a", "b"]);
    expect(text(2)).toEqual(["own"]);
    expect(text(3)).toEqual(["c"]);
  });
});

describe("readDruid", () => {
  const infobox = (inner: string) =>
    article(`<div class="druid-infobox druid-container druid-container-armor">${inner}</div>`);
  const $ = loadHtml(
    infobox(`
      <div class="druid-title">TG-8 Sharpshooter</div>
      <div class="druid-main-image"><a href="/wiki/File:TG-8.png"><img src="/images/thumb/TG-8.png/600px-TG-8.png?1a"></a></div>
      <div class="druid-tab" data-druid-tab-key="Body Armor">Body Armor</div>
      <div class="druid-tab" data-druid-tab-key="Helmet">Helmet</div>
      <div class="druid-row druid-row-cost"><div class="druid-label">Cost</div><div class="druid-data">
        <div class="druid-toggleable-data" data-druid-tab-key="Body Armor">45</div>
        <div class="druid-toggleable-data" data-druid-tab-key="Helmet">30</div>
      </div></div>
      <div class="druid-row druid-row-source"><div class="druid-label">Source</div><div class="druid-data">Castellan's Creed <small>P1</small></div></div>`),
  );
  const druid = readDruid($, "page");

  it("reads container, title, image, tabs and rows", () => {
    expect(druid).toMatchObject({
      container: "armor",
      title: "TG-8 Sharpshooter",
      image: { file: "TG-8.png", src: "/images/thumb/TG-8.png/600px-TG-8.png?1a" },
      tabs: ["Body Armor", "Helmet"],
    });
    expect([...druid.rows.keys()]).toEqual(["cost", "source"]);
    expect(druid.rows.get("cost")?.label).toBe("Cost");
  });

  it("splits tabbed rows instead of gluing their text", () => {
    const cost = druid.rows.get("cost");
    const source = druid.rows.get("source");
    if (!cost || !source) throw new Error("missing rows");
    expect(textOf(cost.data)).toBe("45 30");
    expect(textOf(druidData(cost, "Helmet") ?? $([]))).toBe("30");
    expect(druidData(cost)).toBeNull();
    expect(textOf(druidData(source, "Helmet") ?? $([]))).toBe("Castellan's Creed P1");
  });

  it("reads the main image of each tab", () => {
    const tabbed = readDruid(
      loadHtml(
        infobox(`
          <div class="druid-title">TG-8 Sharpshooter</div>
          <div class="druid-main-images-file" data-druid-tab-key="Body Armor"><img src="/images/TG-8_Armor.png?1"></div>
          <div class="druid-main-images-file" data-druid-tab-key="Helmet"><img src="/images/TG-8_Helmet.png?2"></div>`),
      ),
      "page",
    );
    expect(tabbed.image).toBeNull();
    expect(Object.fromEntries(tabbed.tabImages)).toEqual({
      "Body Armor": { file: "TG-8_Armor.png", src: "/images/TG-8_Armor.png?1" },
      Helmet: { file: "TG-8_Helmet.png", src: "/images/TG-8_Helmet.png?2" },
    });
    expect(druid.tabImages.size).toBe(0);
  });

  it("fails without exactly one infobox or with a duplicate row", () => {
    expect(() => readDruid(loadHtml(article("<p>x</p>")), "page")).toThrow(
      "expected 1 infobox, found 0",
    );
    const twice = '<div class="druid-row druid-row-cost"><div class="druid-data">1</div></div>';
    expect(() =>
      readDruid(loadHtml(infobox(`<div class="druid-title">X</div>${twice}${twice}`)), "page"),
    ).toThrow("duplicate row");
  });

  it("picks one of several infoboxes by container", () => {
    const $$ = loadHtml(
      article(
        '<div class="druid-infobox druid-container"><div class="druid-title">Objective</div></div>' +
          '<div class="druid-infobox druid-container druid-container-stratagem"><div class="druid-title">Link Hellpods</div></div>',
      ),
    );
    expect(readDruid($$, "page", "stratagem")).toMatchObject({
      container: "stratagem",
      title: "Link Hellpods",
    });
    expect(() => readDruid($$, "page")).toThrow("expected 1 infobox, found 2");
    expect(() => readDruid($$, "page", "armor")).toThrow("expected 1 infobox, found 0");
  });
});

describe("readItemBoxes", () => {
  const box = (caption: string) =>
    `<div class="hd2-itembox"><span class="hd2-itembox-img"><a href="/wiki/Liberty%27s_Herald"><img src="/images/thumb/Herald.png/200px-Herald.png?b9"></a></span><span class="hd2-title"><a href="/wiki/Liberty%27s_Herald">Liberty's Herald</a></span><span>${caption}</span></div>`;
  const read = (...captions: string[]) => {
    const $ = loadHtml(article(captions.map(box).join("")));
    return readItemBoxes($, $(".hd2-itembox"));
  };
  const medals = (amount: string) =>
    `<span class="Currencyicons"><span class="Medalicon"><a href="/wiki/Medal"><img src="/images/Medal.svg?6"></a></span> ${amount}</span>`;

  it("splits the caption into source and cost at the first bar", () => {
    const [herald] = read(
      `<a href="/wiki/Helldivers_Mobilize_Warbond#Page_2">Helldivers Mobilize!</a> <small><span class="explain" title="Page 2">P2</span></small> | ${medals("3")}`,
    );
    expect(herald).toEqual({
      name: "Liberty's Herald",
      page: { label: "Liberty's Herald", title: "Liberty's Herald", anchor: null },
      image: { file: "Herald.png", src: "/images/thumb/Herald.png/200px-Herald.png?b9" },
      source: {
        label: "Helldivers Mobilize! P2",
        link: {
          label: "Helldivers Mobilize!",
          title: "Helldivers Mobilize Warbond",
          anchor: "Page_2",
        },
        pageMarker: "Page 2",
      },
      cost: { text: "3", currency: "medals" },
    });
  });

  it("reads plain sources, missing costs and cost links apart from the source", () => {
    const [preOrder, dlc, unannounced, empty] = read(
      'Pre-Order Bonus | <span class="explain" title="Exclusive">❌</span>',
      '<a href="/wiki/Downloadable_Content">Downloadable Content</a>',
      `<a href="/wiki/Ironclad_Democracy_Premium_Warbond">Ironclad Democracy</a> | ${medals("")} <a href="/wiki/Medal">Medals</a>`,
      "",
    );
    expect(preOrder).toMatchObject({
      source: { label: "Pre-Order Bonus", link: null, pageMarker: null },
      cost: { text: "❌", currency: null },
    });
    expect(dlc).toMatchObject({
      source: { label: "Downloadable Content", link: { title: "Downloadable Content" } },
      cost: null,
    });
    expect(unannounced).toMatchObject({
      source: {
        label: "Ironclad Democracy",
        link: { title: "Ironclad Democracy Premium Warbond" },
      },
      cost: { text: "Medals", currency: "medals" },
    });
    expect(empty).toMatchObject({ source: null, cost: null });
    const [escaped] = read("Salt &amp; &lt;Pepper&gt; | ❌");
    expect(escaped?.source?.label).toBe("Salt & <Pepper>");
  });
});

describe("readCodeArrows", () => {
  it("reads arrow icons in order and fails on another icon", () => {
    const arrow = (name: string) =>
      `<span class="Stratagemcodeicon"><img alt="Stratagem Arrow ${name}.svg" src="/images/Stratagem_Arrow_${name}.svg"></span>`;
    const $ = loadHtml(
      `<p id="ok">${arrow("Right")}${arrow("Up")}</p><p id="bad">${arrow("Sideways Left")}</p>`,
    );
    expect(readCodeArrows($, $("#ok"), "page", "#ok")).toEqual(["Right", "Up"]);
    expect(() => readCodeArrows($, $("#bad"), "page", "#bad")).toThrow(ParseError);
  });
});
