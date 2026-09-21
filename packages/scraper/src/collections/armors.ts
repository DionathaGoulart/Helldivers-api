import { Armor, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { armoryName } from "../normalize/armory.ts";
import { parseNumber } from "../normalize/numbers.ts";
import { ARMOR_INDEX, parseArmorIndex } from "../parsers/armor-index.ts";
import { armoryTab, parseArmorPage } from "../parsers/armor-page.ts";
import { flagsFromCategories, isUpcoming } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver, passiveResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Armor` weight tables + every armor page, DRUID tab `Body Armor` (arch §4.3, §5.4).
// The page wins and the index row fills what a page does not state; a difference is a warning.
// The passive resolves against the passives collection, so that pipeline runs first.

const WEIGHTS: Readonly<Record<string, Armor["weight"]>> = {
  Light: "light",
  Medium: "medium",
  Heavy: "heavy",
};

export const armorsPipeline: CollectionPipeline<"armors"> = {
  collection: "armors",
  indexPages: [ARMOR_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger, dataset } = context;
    const resolvePassive = passiveResolver(dataset.passives);
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(ARMOR_INDEX);
    const rows = parseArmorIndex(index.html, { url: index.url }).armors;
    const warnings: string[] = [];

    const entities: Armor[] = [];
    const images: ImageRequest[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseArmorPage(page.html, { url: page.url });
      const id = idLock.resolve("armors", raw.title, raw.title);
      const name = armoryName(raw.name);
      const note = (message: string) => warnings.push(`armors/${id}: ${message}`);
      const tab = armoryTab(raw, "Body Armor");
      if (!tab) {
        throw new NormalizeError(page.url, raw.name, "no Body Armor tab");
      }
      const infobox = (key: string) => tab.rows.find((candidate) => candidate.key === key) ?? null;

      const typeText = infobox("type")?.text ?? row.weight;
      const weight = WEIGHTS[typeText];
      if (!weight) {
        throw new NormalizeError(page.url, typeText, "unknown armor type");
      }
      if (typeText !== row.weight) {
        note(`type differs from ${ARMOR_INDEX} (${row.weight})`);
      }
      const stat = (key: string, label: string, indexText: string) => {
        const pageText = infobox(key)?.text ?? null;
        const value = parseNumber(pageText ?? indexText, page.url);
        if (pageText !== null && parseNumber(indexText, index.url) !== value) {
          note(`${label} differs from ${ARMOR_INDEX} (${indexText})`);
        }
        return value;
      };

      const passiveLink = infobox("passive")?.links[0] ?? row.passive;
      if (passiveLink.title !== row.passive.title) {
        note(`passive differs from ${ARMOR_INDEX} (${row.passive.title})`);
      }
      const itemSource = await resolveSource({
        cell: tab.source ?? row.source,
        cost: tab.cost ?? (row.cost.text ? row.cost : null),
        titles: [raw.title, row.page.title],
        wikiType: `${typeText} Armor`,
        page: page.url,
        note,
      });

      const draft = {
        id,
        slug: slugify(raw.title),
        name,
        upcoming: isUpcoming(raw.categories),
        aliases: [...new Set([row.page.title, raw.title])].filter((t) => t !== name).sort(),
        description: raw.armoryDescription ?? raw.lead,
        image: null, // attached in step 7
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        weight,
        armorRating: stat("armor", "armor rating", row.armor),
        speed: stat("speed", "speed", row.speed),
        staminaRegen: stat("stam_regen", "stamina", row.stamina),
        passiveId: resolvePassive(passiveLink, page.url),
        // One set per armor page (rule 6); the link step rebuilds it from armor-sets.
        setIds: [idLock.resolve("armor-sets", raw.title, raw.title)],
        source: itemSource,
      };
      const armor = Armor.safeParse(draft);
      if (!armor.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(armor.error));
      }
      if (raw.armoryDescription === null) note(`no Armory description on ${page.url}`);
      entities.push(armor.data);
      const image = tab.image ?? row.icon;
      if (image) images.push({ id, variant: null, image });
    }

    logger.info("collection parsed", { collection: "armors", count: entities.length });
    return {
      collection: "armors",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts: [],
      images,
    };
  },
};
