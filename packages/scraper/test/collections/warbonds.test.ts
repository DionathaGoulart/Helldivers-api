import { type Dataset, IdLock, Warbond } from "@hd2/schemas";
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import type { ScrapeContext } from "../../src/collections/types.ts";
import { warbondsPipeline } from "../../src/collections/warbonds.ts";
import { silentLogger } from "../../src/log.ts";
import type { WikiPage, WikiSource } from "../../src/source.ts";
import { article, fixture } from "../fixtures.ts";

const titles = {
  Standard: "Helldivers Mobilize! Warbond",
  Premium: "Ironclad Democracy Premium Warbond",
  Legendary: "Castellan's Creed Legendary Warbond",
} as const;

const index = article(
  Object.entries(titles)
    .map(
      ([type, title]) =>
        `<h3 id="${type}">${type}</h3><div class="Custom_gallery"><ul class="gallery"><li class="gallerybox"><div class="gallerytext"><a href="/wiki/${title.replaceAll(" ", "_")}">${title}</a></div></li></ul></div>`,
    )
    .join(""),
);

async function scrape(modify: (html: string) => string) {
  const source: WikiSource = {
    offline: true,
    robotsTxt: async () => "",
    page: async (title: string): Promise<WikiPage> => {
      if (title === "Warbonds") {
        return {
          title,
          url: "https://helldivers.wiki.gg/wiki/Warbonds",
          html: index,
          fromCache: true,
          lastModified: null,
        };
      }
      const page = await fixture(title);
      return title === titles.Premium ? { ...page, html: modify(page.html) } : page;
    },
  };
  return warbondsPipeline.scrape({
    source,
    idLock: IdLock.from({}),
    overrides: { warbondAliases: {}, sourceLabels: {}, traitAliases: {}, armorSets: {} },
    warbonds: {} as ScrapeContext["warbonds"],
    logger: silentLogger,
    dataset: {} as Dataset,
  });
}

describe("warbonds pipeline", () => {
  it("keeps unknown upcoming amounts null and explicit Free/None as zero", async () => {
    const result = await scrape((html) => {
      const $ = cheerio.load(html);
      $(".druid-row-cost, .druid-row-credit-claim").remove();
      return $.html();
    });
    const upcoming = result.entities.find((entity) => entity.name === "Ironclad Democracy");
    const free = result.entities.find((entity) => entity.type === "standard");
    const none = result.entities.find((entity) => entity.type === "legendary");
    expect(upcoming).toMatchObject({ cost: null, superCreditsClaimable: null });
    expect(result.warnings).toContain("warbonds/ironclad-democracy: price not announced");
    expect(result.warnings).toContain(
      "warbonds/ironclad-democracy: claimable credits not announced",
    );
    expect(free?.cost).toEqual({ currency: "super_credits", amount: 0 });
    expect(none?.superCreditsClaimable).toBe(0);
    expect(Warbond.safeParse(upcoming).success).toBe(true);
    expect(Warbond.safeParse({ ...upcoming, upcoming: false }).success).toBe(false);
  });

  it("retains announced upcoming amounts", async () => {
    const result = await scrape((html) => html);
    expect(result.entities.find((entity) => entity.name === "Ironclad Democracy")).toMatchObject({
      cost: { currency: "super_credits", amount: 1000 },
      superCreditsClaimable: 300,
    });
  });

  it.each([
    ["cost", "TBDX", ".druid-data-cost", "warbond without a price"],
    ["credits", "TBDX", ".druid-data-credit-claim", "warbond without claimable credits"],
    ["cost", "empty", ".druid-data-cost", "warbond without a price"],
    ["credits", "empty", ".druid-data-credit-claim", "warbond without claimable credits"],
  ])(
    "rejects malformed upcoming %s (%s) instead of treating it as unannounced",
    async (_, value, selector, message) => {
      await expect(
        scrape((html) => {
          const $ = cheerio.load(html);
          $(selector).text(value === "empty" ? "" : value);
          return $.html();
        }),
      ).rejects.toThrow(message);
    },
  );
});
