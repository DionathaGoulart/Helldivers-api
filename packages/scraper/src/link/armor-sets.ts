import type { Dataset, Id } from "@hd2/schemas";

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
