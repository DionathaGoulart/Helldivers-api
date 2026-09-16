import { ArmorSet } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { findSetCapes, type SetCape } from "../link/armor-sets.ts";
import { parseSuperstore, SUPERSTORE } from "../parsers/superstore.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// Armor sets (arch §5.5 rule 6): one per armor page, whose body armor and helmet share it.
// Built from the armors and helmets scraped before it. A cape joins a set only with evidence:
// `data/overrides/armor-sets.json`, else a Superstore stock tab or a warbond page offering
// exactly that armor and one cape. Runs after the warbonds, so their pages are this run's.

const OVERRIDES = "data/overrides/armor-sets.json";

export const armorSetsPipeline: CollectionPipeline<"armor-sets"> = {
  collection: "armor-sets",
  indexPages: [SUPERSTORE],

  async scrape({ source, idLock, overrides, logger, dataset }: ScrapeContext) {
    const { armors, helmets, capes, warbonds } = dataset;
    if (!armors || !helmets || !capes || !warbonds) {
      throw new Error(
        "armor-sets need the armors, helmets, capes and warbonds collections: scrape them first",
      );
    }
    const helmetByTitle = new Map(helmets.map((helmet) => [helmet.wiki.title, helmet]));
    const store = await source.page(SUPERSTORE);
    const evidence = findSetCapes({
      armors,
      capes,
      warbonds,
      superstore: parseSuperstore(store.html, { url: store.url }),
    });

    const capeIds = new Set(capes.map((cape) => cape.id));
    const overridden = new Map(
      Object.entries(overrides.armorSets).map(([id, { capeId, evidence }]): [string, SetCape] => {
        if (capeId !== null && !capeIds.has(capeId)) {
          throw new Error(`${OVERRIDES}: "${id}" names cape "${capeId}", which does not exist`);
        }
        const capeLink = capeId === null ? null : { method: "override" as const, evidence };
        return [id, { capeId, capeLink }];
      }),
    );

    const entities = armors.map((armor) => {
      const helmet = helmetByTitle.get(armor.wiki.title);
      if (!helmet) {
        throw new NormalizeError(armor.wiki.url, armor.name, "no helmet on the armor page");
      }
      const id = idLock.resolve("armor-sets", armor.wiki.title, armor.wiki.title);
      const none: SetCape = { capeId: null, capeLink: null };
      const cape = overridden.get(id) ?? evidence.get(armor.id) ?? none;
      const draft = {
        id,
        slug: armor.slug,
        name: armor.name,
        wiki: armor.wiki,
        armorId: armor.id,
        helmetId: helmet.id,
        ...cape,
      };
      const set = ArmorSet.safeParse(draft);
      if (!set.success) {
        throw new NormalizeError(armor.wiki.url, armor.name, z.prettifyError(set.error));
      }
      return set.data;
    });
    const unknown = [...overridden.keys()].find((id) => !entities.some((set) => set.id === id));
    if (unknown) {
      throw new Error(`${OVERRIDES}: "${unknown}" is not an armor set`);
    }

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
