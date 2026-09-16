import type { Dataset, Id } from "@hd2/schemas";
import type { RawEquipmentTraits } from "../parsers/equipment-traits.ts";

// Back-references of weapon traits (arch §5.2): `weaponIds` / `stratagemIds` are the inverse
// of `traitIds`. Runs over the merged dataset after every pipeline, so a run that scrapes only
// weapons still refreshes the traits it points at. A holder collection that is not in the
// dataset leaves its list as published.

export function linkTraitHolders(dataset: Dataset): Dataset {
  const traits = dataset["weapon-traits"];
  if (!traits) {
    return dataset;
  }
  const holders = (list: readonly { id: Id; traitIds: readonly Id[] }[], traitId: Id) =>
    list
      .filter((entity) => entity.traitIds.includes(traitId))
      .map((entity) => entity.id)
      .sort();
  const { weapons, stratagems } = dataset;
  return {
    ...dataset,
    "weapon-traits": traits.map((trait) => ({
      ...trait,
      weaponIds: weapons ? holders(weapons, trait.id) : trait.weaponIds,
      stratagemIds: stratagems ? holders(stratagems, trait.id) : trait.stratagemIds,
    })),
  };
}

const matchKey = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

// Rule 7 (arch §5.5): the trait tables of `/wiki/Equipment_Traits` and the trait links of each
// item page should list the same pairs. Item pages decide `traitIds`, so a difference is a
// warning: a table row that matches no item or an item missing a trait its table lists, and
// traits an item page links but no table lists (unreleased items, before the tables catch up).

export function checkTraitTables(dataset: Dataset, page: RawEquipmentTraits): string[] {
  const traits = dataset["weapon-traits"];
  if (!traits) {
    return [];
  }
  const traitByAnchor = new Map(
    traits.map((trait) => [decodeURIComponent(new URL(trait.wiki.url).hash.slice(1)), trait]),
  );
  const holders = { Weapon: dataset.weapons, Stratagem: dataset.stratagems };
  const collectionOf = { Weapon: "weapons", Stratagem: "stratagems" } as const;
  const warnings: string[] = [];
  const listed = new Set<string>(); // `<collection>/<id>/<trait id>`

  for (const table of page.traits) {
    const trait = traitByAnchor.get(table.anchor);
    if (!trait) {
      continue; // the weapon-traits pipeline reads the same tables
    }
    for (const member of table.members) {
      const list = holders[member.type];
      if (!list) {
        continue;
      }
      const collection = collectionOf[member.type];
      const named = (key: string) =>
        list.filter((entity) =>
          [entity.wiki.title, entity.name, ...entity.aliases].some(
            (candidate) => matchKey(candidate) === matchKey(key),
          ),
        );
      const found = named(member.page.title);
      const [entity, ...others] = found.length > 0 ? found : named(member.name);
      if (!entity || others.length > 0) {
        warnings.push(
          `weapon-traits/${trait.id}: "${member.page.title}" (${member.type}) matches ${entity ? others.length + 1 : 0} ${collection}`,
        );
        continue;
      }
      listed.add(`${collection}/${entity.id}/${trait.id}`);
      if (!entity.traitIds.includes(trait.id)) {
        warnings.push(
          `${collection}/${entity.id}: listed under ${trait.name} on ${page.title}, its page does not link it`,
        );
      }
    }
  }

  for (const type of ["Weapon", "Stratagem"] as const) {
    const collection = collectionOf[type];
    for (const entity of holders[type] ?? []) {
      const unlisted = entity.traitIds.filter(
        (id) => !listed.has(`${collection}/${entity.id}/${id}`),
      );
      if (unlisted.length > 0) {
        warnings.push(
          `${collection}/${entity.id}: traits not listed on ${page.title}: ${unlisted.join(", ")}`,
        );
      }
    }
  }
  return warnings;
}
