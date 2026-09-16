import type { Armor, ArmorSet, Cape, Dataset, Id, Warbond } from "@hd2/schemas";
import type { RawSuperstore } from "../parsers/superstore.ts";
import { collectionsOfType } from "./warbond-items.ts";

// Back-references of armor sets (arch §5.2): `armor.setIds`, `helmet.setIds` and `cape.setIds`
// list the sets that name them. Runs over the merged dataset after every pipeline; without the
// armor-sets collection the parts keep the lists their pipelines gave them.

export function linkSetParts(dataset: Dataset): Dataset {
  const sets = dataset["armor-sets"];
  if (!sets) {
    return dataset;
  }
  const setsOf = (field: "armorId" | "helmetId" | "capeId", id: Id) =>
    sets
      .filter((set) => set[field] === id)
      .map((set) => set.id)
      .sort();
  const { armors, helmets, capes } = dataset;
  return {
    ...dataset,
    ...(armors && {
      armors: armors.map((armor) => ({ ...armor, setIds: setsOf("armorId", armor.id) })),
    }),
    ...(helmets && {
      helmets: helmets.map((helmet) => ({ ...helmet, setIds: setsOf("helmetId", helmet.id) })),
    }),
    ...(capes && {
      capes: capes.map((cape) => ({ ...cape, setIds: setsOf("capeId", cape.id) })),
    }),
  };
}

export type SetCape = Pick<ArmorSet, "capeId" | "capeLink">;

export interface CapeEvidenceInput {
  armors: readonly Armor[];
  capes: readonly Cape[];
  warbonds: readonly Warbond[];
  superstore: RawSuperstore;
}

// Rule 6 (arch §5.5) without the overrides: an armor and a cape are one set only when a page
// offers exactly one of each. Superstore stock tabs come first (O-44 Bonded Pilot with Diagram of
// the Noblest Payload; a tab's cells are the items of its release order table), then warbond
// pages (TG-8 Sharpshooter with Camo Cloak). Rows that match no entity still count, so an
// unreleased second armor or cape on a page leaves both unlinked.

/** The cape of each armor (by armor id) that a page gives evidence for. */
export function findSetCapes({
  armors,
  capes,
  warbonds,
  superstore,
}: CapeEvidenceInput): Map<Id, SetCape> {
  const found = new Map<Id, SetCape>();
  const armorIds = new Set(armors.map((armor) => armor.id));
  const capeIds = new Set(capes.map((cape) => cape.id));

  const armorByTitle = new Map(armors.map((armor) => [armor.wiki.title, armor]));
  const capeByTitle = new Map(capes.map((cape) => [cape.wiki.title, cape]));
  for (const page of superstore.pages) {
    const [armorCell, ...otherArmors] = page.items.filter((item) => item.type === "Armor");
    const [capeCell, ...otherCapes] = page.items.filter((item) => item.type === "Cape");
    const armor = armorCell && armorByTitle.get(armorCell.link.title);
    const cape = capeCell && capeByTitle.get(capeCell.link.title);
    if (!armor || !cape || otherArmors.length > 0 || otherCapes.length > 0) {
      continue;
    }
    found.set(armor.id, {
      capeId: cape.id,
      capeLink: {
        method: "superstore_set",
        evidence: `Superstore page ${page.number} (${page.set.label}) stocks exactly one armor (${armorCell.name}) and one cape (${capeCell.name})`,
      },
    });
  }

  const rowsOf = (items: Warbond["pages"][number]["items"], collection: "armors" | "capes") =>
    items.filter((item) => collectionsOfType(item.wikiType)?.join() === collection);
  for (const warbond of warbonds) {
    for (const page of warbond.pages) {
      const [armorRow, ...otherArmors] = rowsOf(page.items, "armors");
      const [capeRow, ...otherCapes] = rowsOf(page.items, "capes");
      const armorId = armorRow?.ref?.collection === "armors" ? armorRow.ref.id : null;
      const capeId = capeRow?.ref?.collection === "capes" ? capeRow.ref.id : null;
      if (
        !armorRow ||
        !capeRow ||
        !armorId ||
        !capeId ||
        !armorIds.has(armorId) ||
        !capeIds.has(capeId) ||
        otherArmors.length > 0 ||
        otherCapes.length > 0 ||
        found.has(armorId)
      ) {
        continue;
      }
      found.set(armorId, {
        capeId,
        capeLink: {
          method: "warbond_page",
          evidence: `${warbond.id} page ${page.number} lists exactly one armor (${armorRow.name}) and one cape (${capeRow.name})`,
        },
      });
    }
  }
  return found;
}
