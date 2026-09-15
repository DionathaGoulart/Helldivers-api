import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { parseBoosterPage } from "../../src/parsers/booster-page.ts";
import { BOOSTERS_INDEX, parseBoostersIndex } from "../../src/parsers/boosters-index.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("boosters-index parser", async () => {
  const index = await fixture(BOOSTERS_INDEX);
  const rows = parseBoostersIndex(index.html, { url: index.url });

  it("reads every row of the fixture", async () => {
    expect(rows).toHaveLength(18);
    await expect(json(rows)).toMatchFileSnapshot("./__snapshots__/boosters-index.json");
  });

  it("reads names, effect, icon, warbond link with page anchor and icon-aware price", () => {
    expect(rows[0]).toEqual({
      name: "Hellpod Space Optimization",
      page: {
        label: "Hellpod Space Optimization",
        title: "Hellpod Space Optimization",
        anchor: null,
      },
      effect: "Helldivers come out of the Hellpod fully stocked on Ammo, Grenades and Stims.",
      icon: {
        file: "Hellpod_Space_Optimization_Booster_Icon.svg",
        src: "/images/Hellpod_Space_Optimization_Booster_Icon.svg?7aa15a",
      },
      warbond: {
        label: "Helldivers Mobilize",
        title: "Helldivers Mobilize Warbond",
        anchor: "Page_3",
      },
      price: { text: "15 Medals", currency: "medals" },
    });
  });

  it("keeps warbond links without a page anchor", () => {
    expect(rows.find((row) => row.name === "Concealed Insertion")?.warbond).toEqual({
      label: "Redacted Regiment",
      title: "Redacted Regiment Premium Warbond",
      anchor: null,
    });
  });

  it("fails loudly when the layout changes", () => {
    const renamed = index.html.replace(">Price\n</th>", ">Cost\n</th>");
    expect(() => parseBoostersIndex(renamed, { url: index.url })).toThrow('missing column "Price"');
    expect(() => parseBoostersIndex(article("<p>gone</p>"), { url: index.url })).toThrow(
      ParseError,
    );
  });
});

describe("booster-page parser", () => {
  it("reads canonical title, lead and categories", async () => {
    const page = await fixture("Hellpod Space Optimization");
    expect(parseBoosterPage(page.html, { url: page.url })).toEqual({
      title: "Hellpod Space Optimization",
      lead: "Hellpod Space Optimization is a Booster in Helldivers 2. When equipped, all Helldivers in a squad will come out of their Hellpod (either initial deployment or being reinforced) fully stocked with Ammo, Grenades, and Stims. Depending on their equipped armor, their max number of equipment will vary.",
      categories: [
        "Boosters",
        "Pages using DynamicPageList3 parser function",
        "Pages with Auto Breadcrumbs",
        "Pages with navboxes",
      ],
    });
  });

  it("finds the lead after non-paragraph blocks", async () => {
    const page = await fixture("Muscle Enhancement");
    expect(parseBoosterPage(page.html, { url: page.url }).lead).toBe(
      "Muscle Enhancement is a Booster in Helldivers 2. When equipped, all Helldivers will move faster in more difficult terrain and environmental effects.",
    );
  });
});
