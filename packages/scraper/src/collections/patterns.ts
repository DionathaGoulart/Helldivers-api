import { type Conflict, Pattern, type Source, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { parseLevel } from "../normalize/cosmetics.ts";
import { parseCost } from "../normalize/costs.ts";
import { pageFromMarker } from "../normalize/sources.ts";
import { pageFromAnchor } from "../normalize/warbonds.ts";
import { COSMETICS_INDEX, parseCosmeticsIndex } from "../parsers/cosmetics-index.ts";
import { parsePatternPage } from "../parsers/pattern-page.ts";
import type { RawCost } from "../parsers/raw.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Cosmetics` "Patterns" tabber (arch §4.3). Vehicle patterns: one row per pattern with a
// cost per vehicle; each links a pattern page (DRUID tabs Shuttle / Hellpod / Exosuit / FRV)
// that gives the description, maintenance flags and a cost when the row has none. Rule 10: a
// variant's page comes from the warbond row `<Pattern> <Hellpod|Shuttle|Exosuit|Vehicle>`; a
// different page on the pattern page is a conflict. Weapon patterns are index-only (rule 11).

// Hellpod first: the Cosmetics icon is the Hellpod variant and every warbond unlocks it first.
const VEHICLE_TARGETS = ["hellpod", "shuttle", "exosuit", "vehicle"] as const;
const ROW_SUFFIX = {
  hellpod: "Hellpod",
  shuttle: "Shuttle",
  exosuit: "Exosuit",
  vehicle: "Vehicle",
};

// Weapon pattern costs are a slip icon and a number.
const REQUISITION_LABEL = "Requisition Slips";

export const patternsPipeline: CollectionPipeline<"patterns"> = {
  collection: "patterns",
  indexPages: [COSMETICS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger } = context;
    const resolveSource = itemSourceResolver(context);
    const warnings: string[] = [];
    const conflicts: Conflict[] = [];

    const index = await source.page(COSMETICS_INDEX);
    const cosmetics = parseCosmeticsIndex(index.html, { url: index.url });

    const drafts: { name: string; url: string; draft: unknown }[] = [];
    const images: ImageRequest[] = [];
    for (const row of cosmetics.vehiclePatterns) {
      const page = await source.page(row.page.title);
      const raw = parsePatternPage(page.html, { url: page.url });
      const id = idLock.resolve("patterns", raw.title, raw.name);
      const note = (message: string) => warnings.push(`patterns/${id}: ${message}`);
      if (raw.name !== row.name) {
        note(`name differs from ${COSMETICS_INDEX} (${row.name})`);
      }

      const variants: { target: string; image: null; source: Source }[] = [];
      for (const target of VEHICLE_TARGETS) {
        const tab = raw.variants.find((variant) => variant.target === target) ?? null;
        const indexCost = row.costs[target];
        const priced = (cost: RawCost | null | undefined, url: string) =>
          cost?.currency && /\d/.test(cost.text) ? parseCost(cost, url) : null;
        const listedAmount = priced(indexCost, index.url)?.amount;
        const pageAmount = priced(tab?.cost, page.url)?.amount;
        if (listedAmount !== undefined && pageAmount !== undefined && listedAmount !== pageAmount) {
          note(`${target} cost differs from the pattern page (${tab?.cost?.text})`);
        }
        const itemName = `${row.name} ${ROW_SUFFIX[target]}`;
        const variantSource = await resolveSource({
          cell: row.source,
          // A priced page tab fills an empty Cosmetics cell; `Free` on Standard has no currency.
          cost: indexCost.text ? indexCost : tab?.cost?.currency ? tab.cost : null,
          titles: [...new Set([raw.title, row.page.title])],
          wikiType: "Pattern",
          itemName,
          page: page.url,
          note,
        });

        const tabPage = tab?.source
          ? (pageFromMarker(tab.source.pageMarker) ??
            pageFromAnchor(tab.source.link?.anchor ?? null))
          : null;
        if (
          variantSource.type === "warbond" &&
          row.source.link &&
          tab &&
          tabPage !== null &&
          tabPage !== variantSource.page
        ) {
          conflicts.push({
            collection: "patterns",
            id,
            field: `variants[${variants.length}].source.page`,
            rule: 10,
            chosen: variantSource.page,
            candidates: [
              {
                page: wikiUrl(row.source.link.title),
                location: `Page ${variantSource.page} › ${itemName}`,
                value: variantSource.page,
              },
              { page: page.url, location: `infobox › ${tab.tab} › Source`, value: tabPage },
            ],
          });
        }
        variants.push({ target, image: null, source: variantSource });
        // The Cosmetics icon is the Hellpod variant.
        const image = tab?.image ?? (target === "hellpod" ? row.icon : null);
        if (image) images.push({ id, variant: target, image });
      }

      drafts.push({
        name: row.name,
        url: page.url,
        draft: {
          id,
          slug: slugify(raw.name),
          name: raw.name,
          aliases: [row.name].filter((name) => name !== raw.name),
          description: raw.lead,
          image: null, // the first variant image, attached in step 7
          wiki: {
            title: raw.title,
            url: wikiUrl(raw.title),
            flags: flagsFromCategories(raw.categories),
          },
          scope: "vehicle",
          unlockLevel: null,
          variants,
        },
      });
    }

    for (const row of cosmetics.weaponPatterns) {
      const cost = parseCost(row.cost, index.url);
      if (cost?.currency !== "requisition") {
        throw new NormalizeError(index.url, row.cost.text, "weapon pattern cost is not in slips");
      }
      // No page and no row anchor: locked as `Cosmetics#Patterns/<name>`.
      const id = idLock.resolve("patterns", `${cosmetics.title}#Patterns/${row.name}`, row.name);
      if (row.image) images.push({ id, variant: "weapon", image: row.image });
      drafts.push({
        name: row.name,
        url: index.url,
        draft: {
          id,
          slug: slugify(row.name),
          name: row.name,
          aliases: [],
          description: null, // index-only (rule 11)
          image: null, // the variant image, attached in step 7
          wiki: {
            title: cosmetics.title,
            url: wikiUrl(cosmetics.title, "Patterns"),
            flags: flagsFromCategories(cosmetics.categories),
          },
          scope: "weapon",
          unlockLevel: parseLevel(row.levelNeeded, index.url),
          variants: [
            {
              target: "weapon",
              image: null,
              source: {
                type: "requisition",
                label: REQUISITION_LABEL,
                warbondId: null,
                page: null,
                cost,
                rotating: null,
              },
            },
          ],
        },
      });
    }

    const entities = drafts.map(({ name, url, draft }) => {
      const pattern = Pattern.safeParse(draft);
      if (!pattern.success) {
        throw new NormalizeError(url, name, z.prettifyError(pattern.error));
      }
      return pattern.data;
    });

    logger.info("collection parsed", { collection: "patterns", count: entities.length });
    return {
      collection: "patterns",
      entities,
      indexCount: cosmetics.vehiclePatterns.length + cosmetics.weaponPatterns.length,
      warnings,
      conflicts,
      images,
    };
  },
};
