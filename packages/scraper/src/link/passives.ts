import type { Dataset } from "@hd2/schemas";

// Back-references of passives (arch §5.2): `armorIds` is the inverse of `armor.passiveId`.
// Runs over the merged dataset after every pipeline, like the trait holders; without armors in
// the dataset the published lists stay.

export function linkPassiveArmors(dataset: Dataset): Dataset {
  const { passives, armors } = dataset;
  if (!passives || !armors) {
    return dataset;
  }
  return {
    ...dataset,
    passives: passives.map((passive) => ({
      ...passive,
      armorIds: armors
        .filter((armor) => armor.passiveId === passive.id)
        .map((armor) => armor.id)
        .sort(),
    })),
  };
}
