import { type Conflict, slugify, Weapon } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import type { RawSourceCell } from "../normalize/sources.ts";
import { normalizeWarbondLabel, warbondIdFromTitle } from "../normalize/warbonds.ts";
import { normalizeWeaponStats } from "../normalize/weapons.ts";
import { parseWeaponPage } from "../parsers/weapon-page.ts";
import { parseWeaponsIndex, WEAPONS_INDEX } from "../parsers/weapons-index.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver, traitResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Weapons` tabs (category, subcategory) + every weapon page: DRUID infobox, detailed
// statistics tables, traits and source (arch §4.3, §5.4). Traits resolve against the
// weapon-traits collection, so that pipeline runs first. Civilian weapons (tab `Civilian`) take
// their subcategory from the `Weapon Type` row and their source from the Procurement section.

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

// `Weapon Type` of the civilian pages (support weapons, so not the tab labels above).
const CIVILIAN_WEAPON_TYPES: Readonly<Record<string, Weapon["subcategory"]>> = {
  Shotguns: "shotgun",
  Melee: "melee",
};

const TRAIT_ROWS = ["weapon_traits", "throwable_traits"];

export const weaponsPipeline: CollectionPipeline<"weapons"> = {
  collection: "weapons",
  indexPages: [WEAPONS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger, dataset, overrides } = context;
    const resolveTraits = traitResolver(dataset["weapon-traits"], "weapons");
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(WEAPONS_INDEX);
    const rows = parseWeaponsIndex(index.html, { url: index.url });
    const warnings: string[] = [];
    const conflicts: Conflict[] = [];

    const entities: Weapon[] = [];
    const images: ImageRequest[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseWeaponPage(page.html, { url: page.url });
      const id = idLock.resolve("weapons", raw.title, raw.title);
      const note = (message: string) => warnings.push(`weapons/${id}: ${message}`);

      const category = row.category.toLowerCase() as Weapon["category"];
      const civilian = category === "civilian";
      let subcategory: Weapon["subcategory"] | undefined;
      if (civilian) {
        const type = raw.infobox.find((infoboxRow) => infoboxRow.key === "weapon_type")?.text ?? "";
        subcategory = CIVILIAN_WEAPON_TYPES[type];
        if (!subcategory) {
          throw new NormalizeError(page.url, type, "unknown civilian weapon type");
        }
      } else {
        subcategory = SUBCATEGORY_TABS[row.subcategory ?? ""];
        if (!subcategory) {
          throw new NormalizeError(
            index.url,
            row.subcategory ?? "",
            "unknown weapon subcategory tab",
          );
        }
      }

      const traitRow = raw.infobox.find((infoboxRow) => TRAIT_ROWS.includes(infoboxRow.key));
      const traitIds = resolveTraits(traitRow?.links ?? [], page.url);

      // Source: the infobox cell; civilian weapons: the first Procurement link with a known
      // source label ("Minor Places of Interest"), never a warbond (CQC-72 mentions CQC-73's);
      // else the first warbond linked from "Procurement".
      let cell: RawSourceCell | null = raw.source;
      if (!cell && civilian) {
        const labels = new Set(Object.keys(overrides.sourceLabels).map(normalizeWarbondLabel));
        const link = raw.procurement.find((candidate) =>
          labels.has(normalizeWarbondLabel(candidate.label)),
        );
        if (!link) {
          throw new NormalizeError(
            page.url,
            raw.name,
            "no Procurement link with a known source label; map it in data/overrides/source-labels.json",
          );
        }
        cell = { label: link.label, link, pageMarker: null };
      } else if (!cell) {
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
        image: null, // attached in step 7
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
      const image = raw.image ?? row.image;
      if (image) images.push({ id, variant: null, image });
    }

    logger.info("collection parsed", { collection: "weapons", count: entities.length });
    return {
      collection: "weapons",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts,
      images,
    };
  },
};
