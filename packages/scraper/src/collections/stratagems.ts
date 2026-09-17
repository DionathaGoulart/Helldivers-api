import { type Conflict, type Source, Stratagem, slugify } from "@hd2/schemas";
import { z } from "zod";
import { NormalizeError } from "../errors.ts";
import type { ImageRequest } from "../images/attach.ts";
import { parseNumber } from "../normalize/numbers.ts";
import {
  kindFromCategories,
  leadAbbreviations,
  normalizeStratagemStats,
  parseCode,
  parseDepartment,
  permitAndAvailability,
} from "../normalize/stratagems.ts";
import { parseStratagemPage } from "../parsers/stratagem-page.ts";
import { parseStratagemsIndex, STRATAGEMS_INDEX } from "../parsers/stratagems-index.ts";
import { flagsFromCategories } from "../wiki/page.ts";
import { wikiUrl } from "../wiki/title.ts";
import { itemSourceResolver, traitResolver } from "./item-source.ts";
import type { CollectionPipeline, ScrapeContext } from "./types.ts";

// `/wiki/Stratagems` tables (permit, availability, and code, cooldown, cost, level and source
// when a page lacks them) + every stratagem page: DRUID infobox, `General` table, detailed
// statistics and ship modules (arch §4.3, §5.4). Traits resolve against the weapon-traits
// collection, so that pipeline runs first.

// Mission stratagems have no Source row on their page nor a Source column on the index.
const MISSION_SOURCE: Source = {
  type: "other",
  label: "",
  warbondId: null,
  page: null,
  cost: null,
  rotating: null,
};

export const stratagemsPipeline: CollectionPipeline<"stratagems"> = {
  collection: "stratagems",
  indexPages: [STRATAGEMS_INDEX],

  async scrape(context: ScrapeContext) {
    const { source, idLock, logger, dataset } = context;
    const resolveTraits = traitResolver(dataset["weapon-traits"], "stratagems");
    const resolveSource = itemSourceResolver(context);

    const index = await source.page(STRATAGEMS_INDEX);
    const rows = parseStratagemsIndex(index.html, { url: index.url });
    const warnings: string[] = [];
    const conflicts: Conflict[] = [];

    const entities: Stratagem[] = [];
    const images: ImageRequest[] = [];
    for (const row of rows) {
      const page = await source.page(row.page.title);
      const raw = parseStratagemPage(page.html, { url: page.url });
      const id = idLock.resolve("stratagems", raw.title, raw.title);
      const note = (message: string) => warnings.push(`stratagems/${id}: ${message}`);
      const infobox = (key: string) => raw.infobox.find((candidate) => candidate.key === key);

      const { permitType, availability } = permitAndAvailability(row, index.url);
      const kind = kindFromCategories(raw.categories, permitType, page.url);
      const traitIds = resolveTraits(infobox("traits")?.links ?? [], page.url);

      // The page wins; the index row fills what a page does not state.
      const code = parseCode(raw.code.length > 0 ? raw.code : row.code, page.url);
      if (raw.code.length > 0 && raw.code.join() !== row.code.join()) {
        note(`code differs from ${STRATAGEMS_INDEX} (${row.code.join(" ")})`);
      }
      const cell = raw.source ?? row.source;
      if (!cell && permitType !== "mission") {
        throw new NormalizeError(page.url, raw.name, "no Source row and no index source");
      }
      const itemSource = cell
        ? await resolveSource({
            cell,
            cost: raw.cost ?? row.cost,
            titles: [raw.title, row.page.title],
            page: page.url,
            fallbackCurrency: "requisition",
            note,
          })
        : MISSION_SOURCE;
      const level = infobox("unlock_level")?.text ?? row.unlockLevel;
      const unlockLevel = level && /\d/.test(level) ? parseNumber(level, page.url) : null;

      const stats = normalizeStratagemStats(raw, { page: page.url, kind, traitIds });
      for (const conflict of stats.conflicts) {
        conflicts.push({
          collection: "stratagems",
          id,
          ...conflict,
          candidates: conflict.candidates.map((candidate) => ({ page: page.url, ...candidate })),
        });
      }

      const draft = {
        id,
        slug: slugify(raw.title),
        name: raw.name,
        aliases: [...new Set([row.page.title, raw.title, ...leadAbbreviations(raw.lead)])]
          .filter((alias) => alias !== raw.name)
          .sort(),
        description: raw.lead,
        image: null, // attached in step 7
        wiki: {
          title: raw.title,
          url: wikiUrl(raw.title),
          flags: flagsFromCategories(raw.categories),
        },
        permitType,
        availability,
        category:
          itemSource.type === "requisition" ? parseDepartment(itemSource.label, page.url) : null,
        kind,
        traitIds,
        code,
        cooldownS: stats.cooldownS,
        cooldownVariants: stats.cooldownVariants,
        callInTimeS: stats.callInTimeS,
        callInTimeUpgradedS: stats.callInTimeUpgradedS,
        uses: stats.uses,
        unlockLevel,
        shipModules: raw.shipModules.map((module) => ({
          department: parseDepartment(module.department, page.url),
          module: module.module,
          effect: module.effect,
        })),
        supportWeapon: stats.supportWeapon,
        backpack: stats.backpack,
        attacks: stats.attacks,
        statsRaw: stats.statsRaw,
        source: itemSource,
      };
      const stratagem = Stratagem.safeParse(draft);
      if (!stratagem.success) {
        throw new NormalizeError(page.url, raw.name, z.prettifyError(stratagem.error));
      }
      if (raw.lead === null) note(`no description on ${page.url}`);
      entities.push(stratagem.data);
      const image = raw.image ?? row.icon;
      if (image) images.push({ id, variant: null, image });
    }

    logger.info("collection parsed", { collection: "stratagems", count: entities.length });
    return {
      collection: "stratagems",
      entities,
      indexCount: rows.length,
      warnings,
      conflicts,
      images,
    };
  },
};
