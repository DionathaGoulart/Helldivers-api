import { Passive, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { ARMOR_PASSIVES_INDEX, parseArmorPassives } from "../parsers/armor-passives.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Armor_Passives` panels (arch §4.3, §5.4). Passive pages hold no v1 field, so they
// are not fetched and `wiki.flags` stays empty.

export const passivesPipeline: CollectionPipeline<"passives"> = {
  collection: "passives",
  indexPages: [ARMOR_PASSIVES_INDEX],

  async scrape({ source, idLock, logger }: ScrapeContext) {
    const index = await source.page(ARMOR_PASSIVES_INDEX);
    const rows = parseArmorPassives(index.html, { url: index.url });

    const entities = rows.map((row) => {
      const draft = {
        id: idLock.resolve("passives", row.page.title, row.name),
        slug: slugify(row.name),
        name: row.name,
        aliases: [row.page.title].filter((title) => title !== row.name),
        description: row.description,
        image: null, // images arrive in Phase 4
        wiki: { title: row.page.title, url: wikiUrl(row.page.title), flags: [] },
        effects: row.effects,
        armorIds: [], // inverse of armor.passiveId, materialized once armors are scraped (plan 3d)
      };
      const passive = Passive.safeParse(draft);
      if (!passive.success) {
        throw new NormalizeError(index.url, row.name, z.prettifyError(passive.error));
      }
      return passive.data;
    });

    logger.info("collection parsed", { collection: "passives", count: entities.length });
    return { collection: "passives", entities, indexCount: rows.length, warnings: [] };
  },
};
