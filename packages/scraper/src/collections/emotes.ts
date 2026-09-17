import { Emote, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { parseFlag } from "../normalize/cosmetics.ts";
import { COSMETICS_INDEX, parseCosmeticsIndex } from "../parsers/cosmetics-index.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Cosmetics` "Emotes and Poses" table (arch §4.3). Index-only (rule 11): every field
// comes from the row, `description` stays null and emote pages are not fetched, so `wiki.flags`
// stays empty. Warbond links carry a `#Page_N` anchor.

export const emotesPipeline: CollectionPipeline<"emotes"> = {
  collection: "emotes",
  indexPages: [COSMETICS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger } = context;
    const resolveSource = itemSourceResolver(context);
    const warnings: string[] = [];

    const index = await source.page(COSMETICS_INDEX);
    const rows = parseCosmeticsIndex(index.html, { url: index.url }).emotes;

    const entities: Emote[] = [];
    const images: ImageRequest[] = [];
    for (const row of rows) {
      const title = row.page.title;
      const id = idLock.resolve("emotes", title, row.name);
      const draft = {
        id,
        slug: slugify(row.name),
        name: row.name,
        aliases: [title].filter((t) => t !== row.name),
        description: null, // index-only (rule 11)
        image: null, // attached in step 7
        wiki: { title, url: wikiUrl(title), flags: [] },
        emote: parseFlag(row.emote, index.url),
        victoryPose: parseFlag(row.victoryPose, index.url),
        source: await resolveSource({
          cell: row.source,
          cost: row.cost,
          titles: [title],
          itemName: row.name, // warbond rows say "Emote" or "Victory Pose"
          page: index.url,
          note: (message) => warnings.push(`emotes/${id}: ${message}`),
        }),
      };
      const emote = Emote.safeParse(draft);
      if (!emote.success) {
        throw new NormalizeError(index.url, row.name, z.prettifyError(emote.error));
      }
      entities.push(emote.data);
      if (row.icon) images.push({ id, variant: null, image: row.icon });
    }

    logger.info("collection parsed", { collection: "emotes", count: entities.length });
    return {
      collection: "emotes",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts: [],
      images,
    };
  },
};
