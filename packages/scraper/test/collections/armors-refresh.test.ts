import { join } from "node:path";
import type { Dataset, Passive } from "@hd2/schemas";
import { IdLock } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { armorsPipeline } from "../../src/collections/armors.ts";
import { WarbondResolver } from "../../src/normalize/warbonds.ts";
import { readOverrides } from "../../src/overrides.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../../src/parsers/armor-index.ts";
import { FixtureSource, type WikiPage, type WikiSource } from "../../src/source.ts";
import { loadHtml } from "../../src/wiki/html.ts";
import { wikiUrl } from "../../src/wiki/title.ts";
import { FIXTURES_DIR } from "../fixtures.ts";

const logger = { info() {}, warn() {}, error() {} };
const fixtureSource = new FixtureSource(FIXTURES_DIR);

async function passiveDataset(): Promise<Passive[]> {
  const indexPage = await fixtureSource.page(ARMOR_INDEX);
  const index = parseArmorIndex(indexPage.html, { url: indexPage.url });
  const rows = [
    index.armors.find((armor) => armor.weight === "Light"),
    index.armors.find((armor) => armor.page.title === "SA-7 Headfirst"),
    index.armors.find((armor) => armor.weight === "Heavy"),
  ];
  return [
    ...new Set(
      rows
        .map((row) =>
          row?.passive.title === "Supplementary Adrenaline"
            ? "Supplemental Adrenaline"
            : row?.passive.title,
        )
        .filter((title): title is string => Boolean(title)),
    ),
  ].map((title) => {
    const id = title
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      id,
      slug: id,
      name: title,
      upcoming: false,
      aliases: [],
      description: "test passive",
      image: null,
      wiki: { title, url: wikiUrl(title), flags: [] },
      effects: ["test passive"],
      armorIds: [],
    };
  });
}

function refreshedSource(liveTitle: string): { source: WikiSource; freshCalls: string[] } {
  const freshCalls: string[] = [];
  const source: WikiSource = {
    offline: false,
    robotsTxt: () => fixtureSource.robotsTxt(),
    async page(title, options): Promise<WikiPage> {
      const normalized = title.replaceAll("_", " ");
      const page = await fixtureSource.page(title);
      let html = page.html;
      if (normalized === ARMOR_INDEX) {
        const $ = loadHtml(html);
        $("table.wikitable").each((_i, table) => {
          const rows = $(table).find("tr");
          const target = rows.filter(
            (_j, row) => $(row).find('a[href="/wiki/SA-7_Headfirst"]').length > 0,
          );
          const keep = target.length ? target : rows.slice(1, 2);
          rows.slice(1).not(keep).remove();
        });
        html = $.html()
          .replaceAll("Supplementary_Adrenaline", "Supplemental_Adrenaline")
          .replaceAll("Supplementary Adrenaline", "Supplemental Adrenaline");
      }
      if (normalized === "SA-7 Headfirst") {
        if (options?.fresh) {
          freshCalls.push(normalized);
          const $ = loadHtml(html);
          $(".druid-row-armor [data-druid-tab-key='Body Armor']").text("777");
          html = $.html()
            .replaceAll("Supplementary_Adrenaline", liveTitle.replaceAll(" ", "_"))
            .replaceAll("Supplementary Adrenaline", liveTitle);
        }
      } else if (normalized !== "SA-7 Headfirst" && options?.fresh) {
        html = html
          .replaceAll("Supplementary_Adrenaline", "Supplemental_Adrenaline")
          .replaceAll("Supplementary Adrenaline", "Supplemental Adrenaline");
      }
      return {
        ...page,
        html,
        fromCache: normalized === "SA-7 Headfirst" && !options?.fresh,
      };
    },
  };
  return { source, freshCalls };
}

async function scrapeArmors(source: WikiSource, passives: Passive[]) {
  const overrides = await readOverrides(join(import.meta.dirname, "../../../../data"));
  return armorsPipeline.scrape({
    source,
    overrides,
    idLock: IdLock.from({}),
    warbonds: new WarbondResolver({ aliases: {} }),
    logger,
    dataset: { passives } as Dataset,
  });
}

describe("armors cached passive refresh", () => {
  it("refreshes a cached page conflict before deriving armor fields", async () => {
    const { source, freshCalls } = refreshedSource("Supplemental Adrenaline");
    const result = await scrapeArmors(source, await passiveDataset());
    const armor = result.entities.find((item) => item.name === "SA-7 Headfirst");
    expect(freshCalls).toEqual(["SA-7 Headfirst"]);
    expect(armor).toMatchObject({
      name: "SA-7 Headfirst",
      weight: "medium",
      armorRating: 777,
      passiveId: "supplemental-adrenaline",
    });
  }, 30_000);

  it("rejects an unknown passive in the fresh page", async () => {
    const { source, freshCalls } = refreshedSource("Unknown New Passive");
    await expect(scrapeArmors(source, await passiveDataset())).rejects.toThrow(
      "unknown armor passive",
    );
    expect(freshCalls).toEqual(["SA-7 Headfirst"]);
  }, 30_000);
});
