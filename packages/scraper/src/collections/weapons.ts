import { type Conflict, slugify, Weapon } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { RawSourceCell } from "../normalize/sources.ts";
import { warbondIdFromTitle } from "../normalize/warbonds.ts";
import { normalizeWeaponStats } from "../normalize/weapons.ts";
import { parseWeaponPage } from "../parsers/weapon-page.ts";
import { parseWeaponsIndex, WEAPONS_INDEX } from "../parsers/weapons-index.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver, traitResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Weapons` tabs (category, subcategory) + every weapon page: DRUID infobox, detailed
// statistics tables, traits and source (arch §4.3, §5.4). Traits resolve against the
// weapon-traits collection, so that pipeline runs first.

const SUBCATEGORY_TABS: Readonly<Record<string, Weapon["subcategory"]>> = {
  "Assault Rifle": "assault_rifle",
  "Marksman Rifle": "marksman_rifle",
  "Submachine Gun": "submachine_gun",
  Shotgun: "shotgun",
  Explosive: "explosive",
  "Energy-Based": "energy_based",
  Special: "special",
  Pistol: "pistol",
  Melee: "melee",
  Standard: "standard",
};

const TRAIT_ROWS = ["weapon_traits", "throwable_traits"];

export const weaponsPipeline: CollectionPipeline<"weapons"> = {
  collection: "weapons",
  indexPages: [WEAPONS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger, dataset } = context;
    const resolveTraits = traitResolver(dataset["weapon-traits"], "weapons");
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(WEAPONS_INDEX);
    const rows = parseWeaponsIndex(index.html, { url: index.url });
    const warnings: string[] = [];
    const conflicts: Conflict[] = [];

    const entities: Weapon[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseWeaponPage(page.html, { url: page.url });
      const id = idLock.resolve("weapons", raw.title, raw.title);
      const note = (message: string) => warnings.push(`weapons/${id}: ${message}`);

      const subcategory = SUBCATEGORY_TABS[row.subcategory];
      if (!subcategory) {
        throw new NormalizeError(index.url, row.subcategory, "unknown weapon subcategory tab");
      }
      const category = row.category.toLowerCase() as Weapon["category"];

      const traitRow = raw.infobox.find((infoboxRow) => TRAIT_ROWS.includes(infoboxRow.key));
      const traitIds = resolveTraits(traitRow?.links ?? [], page.url);

      // Source: the infobox cell, else the first warbond linked from "Procurement".
      let cell: RawSourceCell | null = raw.source;
      if (!cell) {
        const link = raw.procurement.find((candidate) => warbondIdFromTitle(candidate.title));
        if (!link) {
          throw new NormalizeError(
            page.url,
            raw.name,
            "no Source row and no warbond in Procurement",
          );
        }
        cell = { label: link.label, link, pageMarker: null };
        note(`source read from the Procurement section (${link.title})`);
      }
      const itemSource = await resolveSource({
        cell,
        cost: raw.cost,
        titles: [raw.title, row.page.title],
        page: page.url,
        note,
      });

      const stats = normalizeWeaponStats(raw, { page: page.url, category, subcategory, traitIds });
      for (const conflict of stats.conflicts) {
        conflicts.push({
          collection: "weapons",
          id,
          ...conflict,
          candidates: conflict.candidates.map((candidate) => ({ page: page.url, ...candidate })),
        });
      }

      const draft = {
        id,
        slug: slugify(raw.title),
        name: raw.name,
        aliases: [...new Set([row.page.title, raw.title])].filter((t) => t !== raw.name).sort(),
        description: raw.lead,
        image: null, // images arrive in Phase 4
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        category,
        subcategory,
        traitIds,
        firearm: stats.firearm,
        throwable: stats.throwable,
        attacks: stats.attacks,
        statsRaw: stats.statsRaw,
        source: itemSource,
      };
      const weapon = Weapon.safeParse(draft);
      if (!weapon.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(weapon.error));
      }
      if (raw.lead === null) note(`no description on ${page.url}`);
      if (raw.tables.length === 0) note(`no detailed statistics tables on ${page.url}`);
      entities.push(weapon.data);
    }

    logger.info("collection parsed", { collection: "weapons", count: entities.length });
    return { collection: "weapons", entities, indexCount: rows.length, warnings, conflicts };
  },
};
