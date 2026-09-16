import { PlayerCard, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { armoryName } from "../normalize/armory.ts";
import { ARMOR_INDEX, parseArmorIndex, type RawItemBox } from "../parsers/armor-index.ts";
import { parseArmorPage, type RawArmoryPage } from "../parsers/armor-page.ts";
import { COSMETICS_INDEX, parseCosmeticsIndex } from "../parsers/cosmetics-index.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Cosmetics` player card grid + the `Player Card` DRUID tab of cape pages (arch §4.3,
// rule 9). The grid lacks unreleased cards, so cape pages linked from `/wiki/Armor` with a
// `Player Card` tab complete the index. Cards on a cape page take the page's source and cost
// and pair with that cape; standalone cards (Solid Black) are index-only. The in-game
// description of a cape page describes the cape, so cards have none.

const TAB = "Player Card";

interface Entry {
  title: string; // page the card lives on
  box: RawItemBox | null; // Cosmetics grid box
  page: { url: string; raw: RawArmoryPage } | null; // cape page with a Player Card tab
}

export const playerCardsPipeline: CollectionPipeline<"player-cards"> = {
  collection: "player-cards",
  indexPages: [COSMETICS_INDEX, ARMOR_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger, dataset } = context;
    const capes = dataset.capes;
    if (!capes) {
      throw new Error("player-cards need the capes collection: scrape capes first");
    }
    const capeByTitle = new Map(capes.map((cape) => [cape.wiki.title, cape.id]));
    const resolveSource = itemSourceResolver(context);
    const warnings: string[] = [];

    const cosmetics = await source.page(COSMETICS_INDEX);
    const grid = parseCosmeticsIndex(cosmetics.html, { url: cosmetics.url }).playerCards;
    const armor = await source.page(ARMOR_INDEX);
    const capeBoxes = parseArmorIndex(armor.html, { url: armor.url }).capes;
    const capePages = new Set(capeBoxes.map((box) => box.page.title));

    const readCapePage = async (title: string) => {
      const page = await source.page(title);
      const raw = parseArmorPage(page.html, { url: page.url });
      return raw.tabs.some((tab) => tab.name === TAB) ? { url: page.url, raw } : null;
    };
    const entries: Entry[] = [];
    for (const box of grid) {
      const title = box.page.title;
      entries.push({ title, box, page: capePages.has(title) ? await readCapePage(title) : null });
    }
    const listed = new Set(grid.map((box) => box.page.title));
    for (const box of capeBoxes) {
      if (listed.has(box.page.title)) {
        continue;
      }
      const page = await readCapePage(box.page.title);
      if (page) {
        entries.push({ title: box.page.title, box: null, page });
      }
    }

    const entities: PlayerCard[] = [];
    for (const { title, box, page } of entries) {
      const tab = page?.raw.tabs.find((candidate) => candidate.name === TAB) ?? null;
      const pageTitle = page?.raw.title ?? title;
      const id = idLock.resolve("player-cards", pageTitle, pageTitle);
      const name = page ? armoryName(page.raw.name) : (box?.name ?? title);
      const url = page?.url ?? cosmetics.url;
      const note = (message: string) => warnings.push(`player-cards/${id}: ${message}`);

      const cell = tab?.source ?? box?.source ?? null;
      if (!cell) {
        throw new NormalizeError(url, name, "no Source row and no Cosmetics source");
      }
      if (tab?.source && box?.source && tab.source.label !== box.source.label) {
        note(`source differs from ${COSMETICS_INDEX} (${box.source.label})`);
      }
      if (tab?.cost && box?.cost && tab.cost.text !== box.cost.text) {
        note(`cost differs from ${COSMETICS_INDEX} (${box.cost.text})`);
      }
      const itemSource = await resolveSource({
        cell,
        cost: tab?.cost ?? box?.cost ?? null,
        titles: [...new Set([pageTitle, title])],
        wikiType: TAB,
        page: url,
        note,
      });

      let pairedCapeId: string | null = null;
      if (page?.raw.tabs.some((candidate) => candidate.name === "Cape")) {
        pairedCapeId = capeByTitle.get(pageTitle) ?? null;
        if (!pairedCapeId) {
          throw new NormalizeError(page.url, name, "no cape scraped for this page (rule 9)");
        }
      }

      const draft = {
        id,
        slug: slugify(pageTitle),
        name,
        aliases: [...new Set([box?.page.title ?? pageTitle, pageTitle])]
          .filter((t) => t !== name)
          .sort(),
        description: null, // the page's Armory quote describes the cape
        image: null, // images arrive in Phase 4
        wiki: {
          title: pageTitle,
          url: wikiUrl(pageTitle),
          flags: page ? flagsFromCategories(page.raw.categories) : [],
        },
        pairedCapeId,
        source: itemSource,
      };
      const card = PlayerCard.safeParse(draft);
      if (!card.success) {
        throw new NormalizeError(url, name, z.prettifyError(card.error));
      }
      entities.push(card.data);
    }

    logger.info("collection parsed", { collection: "player-cards", count: entities.length });
    return {
      collection: "player-cards",
      entities,
      indexCount: entries.length,
      warnings,
      conflicts: [],
    };
  },
};
