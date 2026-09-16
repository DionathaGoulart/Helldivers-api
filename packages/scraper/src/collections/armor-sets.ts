import { ArmorSet } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// Armor sets (arch §5.5 rule 6): one per armor page, whose body armor and helmet share it.
// Built from the armors and helmets scraped before it, so it fetches nothing. Capes are linked
// with evidence in plan 3g; until then every set has `capeId: null`.

export const armorSetsPipeline: CollectionPipeline<"armor-sets"> = {
  collection: "armor-sets",
  indexPages: [],

  async scrape({ idLock, logger, dataset }: ScrapeContext) {
    const { armors, helmets } = dataset;
    if (!armors || !helmets) {
      throw new Error("armor-sets need the armors and helmets collections: scrape them first");
    }
    const helmetByTitle = new Map(helmets.map((helmet) => [helmet.wiki.title, helmet]));

    const entities = armors.map((armor) => {
      const helmet = helmetByTitle.get(armor.wiki.title);
      if (!helmet) {
        throw new NormalizeError(armor.wiki.url, armor.name, "no helmet on the armor page");
      }
      const draft = {
        id: idLock.resolve("armor-sets", armor.wiki.title, armor.wiki.title),
        slug: armor.slug,
        name: armor.name,
        wiki: armor.wiki,
        armorId: armor.id,
        helmetId: helmet.id,
        capeId: null,
        capeLink: null,
      };
      const set = ArmorSet.safeParse(draft);
      if (!set.success) {
        throw new NormalizeError(armor.wiki.url, armor.name, z.prettifyError(set.error));
      }
      return set.data;
    });

    logger.info("collection parsed", { collection: "armor-sets", count: entities.length });
    return {
      collection: "armor-sets",
      entities,
      indexCount: armors.length, // every armor page is a set
      warnings: [],
      conflicts: [],
    };
  },
};
