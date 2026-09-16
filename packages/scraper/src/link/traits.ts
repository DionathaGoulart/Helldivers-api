import type { Dataset, Id } from "@hd2/schemas";

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
