import { slugify, Title } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { parseLevel } from "../normalize/cosmetics.ts";
import { COSMETICS_INDEX, parseCosmeticsIndex } from "../parsers/cosmetics-index.ts";
import type { RawLink } from "../parsers/raw.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Cosmetics` "Titles" tables (arch §4.3): rank titles (`Level Earned`, source
// `progression`) and acquirable titles (`Source`, `Cost`). Index-only (rule 11): `description`
// stays null and title pages are not fetched.

export const titlesPipeline: CollectionPipeline<"titles"> = {
  collection: "titles",
  indexPages: [COSMETICS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger } = context;
    const resolveSource = itemSourceResolver(context);
    const warnings: string[] = [];

    const index = await source.page(COSMETICS_INDEX);
    const { rankTitles, acquirableTitles } = parseCosmeticsIndex(index.html, { url: index.url });

    const base = (name: string, page: RawLink) => ({
      id: idLock.resolve("titles", page.title, name),
      slug: slugify(name),
      name,
      aliases: [page.title].filter((title) => title !== name),
      description: null, // index-only (rule 11)
      image: null, // images arrive in Phase 4
      wiki: { title: page.title, url: wikiUrl(page.title), flags: [] },
    });
    const drafts: { name: string; draft: unknown }[] = rankTitles.map((row) => {
      const level = parseLevel(row.level, index.url);
      const draft = {
        ...base(row.name, row.page),
        kind: "rank",
        levelEarned: level,
        source: {
          type: "progression",
          label: `Level ${level}`,
          warbondId: null,
          page: null,
          cost: null,
          rotating: null,
        },
      };
      return { name: row.name, draft };
    });
    for (const row of acquirableTitles) {
      const fields = base(row.name, row.page);
      const draft = {
        ...fields,
        kind: "acquirable",
        levelEarned: null,
        source: await resolveSource({
          cell: row.source,
          cost: row.cost,
          titles: [row.page.title],
          wikiType: "Title",
          itemName: row.name, // title rows on warbond pages link nothing
          page: index.url,
          note: (message) => warnings.push(`titles/${fields.id}: ${message}`),
        }),
      };
      drafts.push({ name: row.name, draft });
    }

    const entities = drafts.map(({ name, draft }) => {
      const title = Title.safeParse(draft);
      if (!title.success) {
        throw new NormalizeError(index.url, name, z.prettifyError(title.error));
      }
      return title.data;
    });

    logger.info("collection parsed", { collection: "titles", count: entities.length });
    return {
      collection: "titles",
      entities,
      indexCount: rankTitles.length + acquirableTitles.length,
      warnings,
      conflicts: [],
    };
  },
};
