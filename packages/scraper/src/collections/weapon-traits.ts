import { slugify, WeaponTrait } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { EQUIPMENT_TRAITS_INDEX, parseEquipmentTraits } from "../parsers/equipment-traits.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Equipment_Traits`: one trait per table; the "All Traits" list is the index
// (arch §4.3, §5.5 rule 7). Traits are index-only rows, locked as `Equipment Traits#<anchor>`.
// A table whose heading is aliased in data/overrides/trait-aliases.json is a misspelling of
// another trait ("Anti Tank" for "Anti-Tank"): it is no trait of its own.

export const weaponTraitsPipeline: CollectionPipeline<"weapon-traits"> = {
  collection: "weapon-traits",
  indexPages: [EQUIPMENT_TRAITS_INDEX],

  async scrape({ source, idLock, overrides, logger }: ScrapeContext) {
    const index = await source.page(EQUIPMENT_TRAITS_INDEX);
    const page = parseEquipmentTraits(index.html, { url: index.url });
    const warnings: string[] = [];

    const tables = new Map(page.traits.map((trait) => [trait.name, trait]));
    for (const { name, count } of page.listed) {
      const trait = tables.get(name);
      if (!trait) {
        warnings.push(`weapon-traits: "${name}" is listed on ${index.url} but has no table`);
      } else if (trait.members.length !== count) {
        warnings.push(
          `weapon-traits: "${name}" is listed with ${count} items, its table has ${trait.members.length}`,
        );
      }
    }

    const misspelled = (anchor: string | undefined) =>
      anchor !== undefined && Object.hasOwn(overrides.traitAliases, anchor);
    const entities = page.traits
      .filter((trait) => !misspelled(trait.anchor))
      .map((trait) => {
        const draft = {
          id: idLock.resolve("weapon-traits", `${page.title}#${trait.anchor}`, trait.name),
          slug: slugify(trait.name),
          name: trait.name,
          upcoming: false, // every trait comes from the Equipment Traits page
          aliases: [],
          description: null, // the wiki describes no trait (D11)
          image: null,
          wiki: {
            title: page.title,
            url: wikiUrl(page.title, trait.anchor),
            flags: flagsFromCategories(page.categories),
          },
          // Inverse of weapon / stratagem `traitIds`, materialized once those collections are
          // scraped (plan 3b, 3c); the table members feed the rule 7 cross-check (plan 3g).
          weaponIds: [],
          stratagemIds: [],
        };
        const entity = WeaponTrait.safeParse(draft);
        if (!entity.success) {
          throw new NormalizeError(index.url, trait.name, z.prettifyError(entity.error));
        }
        return entity.data;
      });

    logger.info("collection parsed", { collection: "weapon-traits", count: entities.length });
    return {
      collection: "weapon-traits",
      entities,
      // A misspelled trait is listed too, but the entity it folds into is counted once.
      indexCount: page.listed.filter(({ name }) => !misspelled(tables.get(name)?.anchor)).length,
      warnings,
      conflicts: [],
      images: [], // the wiki has no trait pictures
    };
  },
};
