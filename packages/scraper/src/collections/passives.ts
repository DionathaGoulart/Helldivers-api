import { Passive, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../parsers/armor-index.ts";
import {
  ARMOR_PASSIVES_INDEX,
  parseArmorPassivePage,
  parseArmorPassives,
} from "../parsers/armor-passives.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Armor_Passives` panels (arch §4.3, §5.4). Passive pages hold no other v1 field, so
// they are fetched only for passives an armor on `/wiki/Armor` links but the panels do not list
// yet (Blunt-Force Mitigation of the unreleased Ironclad Democracy armors on 2026-09-16).
// `wiki.flags` stays empty.

export const passivesPipeline: CollectionPipeline<"passives"> = {
  collection: "passives",
  indexPages: [ARMOR_PASSIVES_INDEX, ARMOR_INDEX],

  async scrape({ source, idLock, logger }: ScrapeContext) {
    const index = await source.page(ARMOR_PASSIVES_INDEX);
    const rows = parseArmorPassives(index.html, { url: index.url });
    const warnings: string[] = [];

    const armorIndex = await source.page(ARMOR_INDEX);
    const listed = new Set(rows.map((row) => row.page.title));
    const unlisted = [
      ...new Set(
        parseArmorIndex(armorIndex.html, { url: armorIndex.url }).armors.map(
          (armor) => armor.passive.title,
        ),
      ),
    ].filter((title) => !listed.has(title));
    for (const title of unlisted) {
      const page = await source.page(title);
      rows.push(parseArmorPassivePage(page.html, { url: page.url }));
      warnings.push(
        `passives: ${title} is not listed on ${ARMOR_PASSIVES_INDEX}; read ${page.url}`,
      );
    }

    const entities = rows.map((row) => {
      const draft = {
        id: idLock.resolve("passives", row.page.title, row.name),
        slug: slugify(row.name),
        name: row.name,
        aliases: [row.page.title].filter((title) => title !== row.name),
        description: row.description,
        image: null, // attached in step 7
        wiki: { title: row.page.title, url: wikiUrl(row.page.title), flags: [] },
        effects: row.effects,
        armorIds: [], // inverse of armor.passiveId, filled by the link step
      };
      const passive = Passive.safeParse(draft);
      if (!passive.success) {
        throw new NormalizeError(index.url, row.name, z.prettifyError(passive.error));
      }
      return passive.data;
    });

    logger.info("collection parsed", { collection: "passives", count: entities.length });
    return {
      collection: "passives",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts: [],
      images: rows.flatMap((row, i) => {
        const id = entities[i]?.id;
        return row.icon && id ? [{ id, variant: null, image: row.icon }] : [];
      }),
    };
  },
};
