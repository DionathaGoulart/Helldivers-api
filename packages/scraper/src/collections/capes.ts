import { Cape, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { armoryName } from "../normalize/armory.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../parsers/armor-index.ts";
import { armoryTab, parseArmorPage } from "../parsers/armor-page.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Armor` tab `Cape` + every cape page: DRUID tab `Cape`, or the whole infobox on pages
// without tabs (arch §4.3, §4.5). Sets link capes in plan 3g and player cards arrive in 3e,
// so `setIds` stays empty and `playerCardId` null until then.

export const capesPipeline: CollectionPipeline<"capes"> = {
  collection: "capes",
  indexPages: [ARMOR_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger } = context;
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(ARMOR_INDEX);
    const boxes = parseArmorIndex(index.html, { url: index.url }).capes;
    const warnings: string[] = [];

    const entities: Cape[] = [];
    for (const box of boxes) {
      const page = await source.page(box.page.title);
      const raw = parseArmorPage(page.html, { url: page.url });
      const id = idLock.resolve("capes", raw.title, raw.title);
      const name = armoryName(raw.name);
      const note = (message: string) => warnings.push(`capes/${id}: ${message}`);
      const tab = armoryTab(raw, "Cape");
      if (!tab) {
        throw new NormalizeError(page.url, raw.name, "no Cape tab");
      }

      const cell = tab.source ?? box.source;
      if (!cell) {
        throw new NormalizeError(page.url, raw.name, "no Source row and no index source");
      }
      const itemSource = await resolveSource({
        cell,
        cost: tab.cost ?? box.cost,
        titles: [raw.title, box.page.title],
        wikiType: "Cape",
        page: page.url,
        note,
      });

      const draft = {
        id,
        slug: slugify(raw.title),
        name,
        aliases: [...new Set([box.page.title, raw.title])].filter((t) => t !== name).sort(),
        description: raw.armoryDescription ?? raw.lead,
        image: null, // images arrive in Phase 4
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        setIds: [], // cape links arrive with plan 3g (rule 6)
        playerCardId: null, // player cards arrive with plan 3e (rule 9)
        source: itemSource,
      };
      const cape = Cape.safeParse(draft);
      if (!cape.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(cape.error));
      }
      if (raw.armoryDescription === null) note(`no Armory description on ${page.url}`);
      entities.push(cape.data);
    }

    logger.info("collection parsed", { collection: "capes", count: entities.length });
    return { collection: "capes", entities, indexCount: boxes.length, warnings, conflicts: [] };
  },
};
