import { Helmet, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { armoryName } from "../normalize/armory.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../parsers/armor-index.ts";
import { armoryTab, parseArmorPage } from "../parsers/armor-page.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Armor` tab `Helmet` + the page each box links: an armor page (DRUID tab `Helmet`,
// shared with the armors pipeline) or a standalone helmet page such as IX-Voidwalker
// (arch §4.3, §4.5). The Armory quote of an armor page describes the body armor, so only
// standalone helmets get a description.

export const helmetsPipeline: CollectionPipeline<"helmets"> = {
  collection: "helmets",
  indexPages: [ARMOR_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger } = context;
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(ARMOR_INDEX);
    const boxes = parseArmorIndex(index.html, { url: index.url }).helmets;
    const warnings: string[] = [];

    const entities: Helmet[] = [];
    const images: ImageRequest[] = [];
    for (const box of boxes) {
      const page = await source.page(box.page.title);
      const raw = parseArmorPage(page.html, { url: page.url });
      const id = idLock.resolve("helmets", raw.title, raw.title);
      const name = armoryName(raw.name);
      const note = (message: string) => warnings.push(`helmets/${id}: ${message}`);
      const tab = armoryTab(raw, "Helmet");
      if (!tab) {
        throw new NormalizeError(page.url, raw.name, "no Helmet tab");
      }
      const standalone = !raw.tabs.some((candidate) => candidate.name === "Body Armor");

      const cell = tab.source ?? box.source;
      if (!cell) {
        throw new NormalizeError(page.url, raw.name, "no Source row and no index source");
      }
      const itemSource = await resolveSource({
        cell,
        cost: tab.cost ?? box.cost,
        titles: [raw.title, box.page.title],
        wikiType: "Helmet",
        page: page.url,
        note,
      });

      const draft = {
        id,
        slug: slugify(raw.title),
        name,
        aliases: [...new Set([box.page.title, raw.title])].filter((t) => t !== name).sort(),
        description: standalone ? (raw.armoryDescription ?? raw.lead) : null,
        image: null, // attached in step 7
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        // The armor page's set (rule 6); the link step rebuilds it from armor-sets.
        setIds: standalone ? [] : [idLock.resolve("armor-sets", raw.title, raw.title)],
        source: itemSource,
      };
      const helmet = Helmet.safeParse(draft);
      if (!helmet.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(helmet.error));
      }
      entities.push(helmet.data);
      const image = tab.image ?? box.image;
      if (image) images.push({ id, variant: null, image });
    }

    logger.info("collection parsed", { collection: "helmets", count: entities.length });
    return {
      collection: "helmets",
      entities,
      indexCount: boxes.length,
      warnings,
      conflicts: [],
      images,
    };
  },
};
