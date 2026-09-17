import { Booster, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { parseCost } from "../normalize/costs.ts";
import { pageFromAnchor } from "../normalize/warbonds.ts";
import { parseBoosterPage } from "../parsers/booster-page.ts";
import {
  BOOSTERS_INDEX,
  parseBoostersIndex,
  type RawBoosterRow,
} from "../parsers/boosters-index.ts";
import { findItemPage, parseWarbondPage, type RawWarbondPage } from "../parsers/warbond-page.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Boosters` rows + each booster's lead paragraph (arch §4.3, §5.4).

export const boostersPipeline: CollectionPipeline<"boosters"> = {
  collection: "boosters",
  indexPages: [BOOSTERS_INDEX],

  async scrape({ source, idLock, warbonds, logger }: ScrapeContext) {
    const index = await source.page(BOOSTERS_INDEX);
    const rows = parseBoostersIndex(index.html, { url: index.url });
    const warbondPages = new Map<string, RawWarbondPage>();
    const warnings: string[] = [];

    // Rule 3 page order: href anchor, then the warbond page table that lists the booster.
    const pageOf = async (row: RawBoosterRow, titles: readonly string[]): Promise<number> => {
      const fromAnchor = pageFromAnchor(row.warbond.anchor);
      if (fromAnchor !== null) {
        return fromAnchor;
      }
      let warbond = warbondPages.get(row.warbond.title);
      if (!warbond) {
        const page = await source.page(row.warbond.title);
        warbond = parseWarbondPage(page.html, { url: page.url });
        warbondPages.set(row.warbond.title, warbond);
      }
      for (const title of titles) {
        const found = findItemPage(warbond, title, "Booster");
        if (found !== null) {
          return found;
        }
      }
      throw new NormalizeError(index.url, row.name, `no page lists it on ${row.warbond.title}`);
    };

    const entities: Booster[] = [];
    const images: ImageRequest[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseBoosterPage(page.html, { url: page.url });
      const id = idLock.resolve("boosters", raw.title, row.name);
      const draft = {
        id,
        slug: slugify(row.name),
        name: row.name,
        aliases: [...new Set([row.page.title, raw.title])].filter((t) => t !== row.name).sort(),
        description: raw.lead,
        image: null, // attached in step 7
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        effect: row.effect,
        source: {
          type: "warbond",
          label: row.warbond.label,
          warbondId: warbonds.resolve(row.warbond, row.warbond.label, index.url),
          page: await pageOf(row, [raw.title, row.page.title]),
          cost: parseCost(row.price, index.url),
          rotating: null,
        },
      };
      const booster = Booster.safeParse(draft);
      if (!booster.success) {
        throw new NormalizeError(page.url, row.name, z.prettifyError(booster.error));
      }
      if (raw.lead === null) {
        warnings.push(`boosters/${id}: no description on ${page.url}`);
      }
      entities.push(booster.data);
      if (row.icon) images.push({ id, variant: null, image: row.icon });
    }

    logger.info("collection parsed", { collection: "boosters", count: entities.length });
    return {
      collection: "boosters",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts: [],
      images,
    };
  },
};
