import { join } from "node:path";
import { checkIntegrity, type Dataset, type WeaponTrait } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { linkTraitHolders } from "../../src/link/traits.ts";

// Synthetic data/v1 of packages/schemas: weapons and stratagems with traitIds.
const { files } = await readDatasetFiles(
  join(import.meta.dirname, "..", "..", "..", "schemas", "test", "dataset"),
);
const list = <T>(collection: string) => (files.get(`${collection}.json`) as { data: T[] }).data;

describe("linkTraitHolders", () => {
  const traits = list<WeaponTrait>("weapon-traits");
  const cleared: Dataset = {
    "weapon-traits": traits.map((trait) => ({ ...trait, weaponIds: [], stratagemIds: [] })),
    weapons: list("weapons"),
    stratagems: list("stratagems"),
  };

  it("rebuilds weaponIds and stratagemIds as the inverse of traitIds", () => {
    const linked = linkTraitHolders(cleared);
    expect(linked["weapon-traits"]).toEqual(traits);
    // Only the unscraped warbonds dangle in this partial dataset.
    expect(checkIntegrity(linked).filter((issue) => issue.collection === "weapon-traits")).toEqual(
      [],
    );
  });

  it("keeps the lists of holder collections that are not in the dataset", () => {
    const { stratagems: _, ...withoutStratagems } = cleared;
    const linked = linkTraitHolders(withoutStratagems);
    const orbital = linked["weapon-traits"]?.find((trait) => trait.id === "orbital");
    expect(orbital?.stratagemIds).toEqual([]);
    expect(linkTraitHolders({ weapons: list("weapons") })).toEqual({ weapons: list("weapons") });
  });
});
