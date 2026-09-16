import { type Conflict, type Cost, type Id, slugify, Weapon } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import { parseCost } from "../normalize/costs.ts";
import { classifySource, type RawSourceCell } from "../normalize/sources.ts";
import { warbondIdFromTitle } from "../normalize/warbonds.ts";
import { normalizeWeaponStats } from "../normalize/weapons.ts";
import type { RawCost } from "../parsers/raw.ts";
import { findItem, parseWarbondPage, type RawWarbondPage } from "../parsers/warbond-page.ts";
import { parseWeaponPage } from "../parsers/weapon-page.ts";
import { parseWeaponsIndex, WEAPONS_INDEX } from "../parsers/weapons-index.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
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

  async scrape({ source, overrides, idLock, warbonds, logger, dataset }: ScrapeContext) {
    const traits = dataset["weapon-traits"];
    if (!traits) {
      throw new Error("weapons need the weapon-traits collection: scrape weapon-traits first");
    }
    const traitByAnchor = new Map(
      traits.map((trait) => [decodeURIComponent(new URL(trait.wiki.url).hash.slice(1)), trait.id]),
    );

    const index = await source.page(WEAPONS_INDEX);
    const rows = parseWeaponsIndex(index.html, { url: index.url });
    const warnings: string[] = [];
    const conflicts: Conflict[] = [];

    const warbondPages = new Map<string, RawWarbondPage>();
    const warbondPage = async (title: string) => {
      let warbond = warbondPages.get(title);
      if (!warbond) {
        const page = await source.page(title);
        warbond = parseWarbondPage(page.html, { url: page.url });
        warbondPages.set(title, warbond);
      }
      return warbond;
    };

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
      const traitIds = (traitRow?.links ?? []).map((link) => {
        const trait =
          link.title === "Equipment Traits" && link.anchor ? traitByAnchor.get(link.anchor) : null;
        if (!trait) {
          throw new NormalizeError(page.url, link.label, "unknown weapon trait");
        }
        return trait;
      });

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
      const kind = classifySource(cell, {
        warbonds,
        sourceLabels: overrides.sourceLabels,
        page: page.url,
      });

      const readCost = (rawCost: RawCost | null, url: string): Cost | null => {
        if (!rawCost) return null;
        if (!/\d/.test(rawCost.text) && rawCost.currency) {
          note(`cost not announced (${JSON.stringify(rawCost.text)})`);
          return null;
        }
        return parseCost(rawCost, url);
      };
      let cost = readCost(raw.cost, page.url);
      let sourcePage = kind.page;
      if (kind.type === "warbond" && (sourcePage === null || !raw.cost) && cell.link) {
        // Rule 3: the warbond page table that lists the weapon gives the page (and the cost
        // when the weapon page has none).
        const warbond = await warbondPage(cell.link.title);
        const listed =
          findItem(warbond, raw.title, null) ?? findItem(warbond, row.page.title, null);
        if (!listed) {
          throw new NormalizeError(page.url, raw.name, `no page lists it on ${cell.link.title}`);
        }
        sourcePage ??= listed.page;
        if (!raw.cost) {
          cost = readCost(listed.item.cost, wikiUrl(warbond.title));
        }
      }

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
        traitIds: [...new Set<Id>(traitIds)],
        firearm: stats.firearm,
        throwable: stats.throwable,
        attacks: stats.attacks,
        statsRaw: stats.statsRaw,
        source: {
          type: kind.type,
          label: cell.label,
          warbondId: kind.warbondId,
          page: sourcePage,
          cost,
          rotating: kind.type === "superstore" ? false : null, // arch §4.5: no rotation left
        },
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
