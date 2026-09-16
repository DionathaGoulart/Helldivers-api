import { join } from "node:path";
import {
  checkIntegrity,
  type Dataset,
  type Stratagem,
  type Weapon,
  type WeaponTrait,
} from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { checkTraitTables, linkTraitHolders } from "../../src/link/traits.ts";
import type { RawEquipmentTraits, RawTraitMember } from "../../src/parsers/equipment-traits.ts";

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

describe("checkTraitTables", () => {
  const traits = list<WeaponTrait>("weapon-traits");
  const weapons = list<Weapon>("weapons");
  const stratagems = list<Stratagem>("stratagems");
  const dataset: Dataset = { "weapon-traits": traits, weapons, stratagems };
  const member = (title: string, type: RawTraitMember["type"], name = title) => ({
    page: { label: title, title, anchor: null },
    name,
    type,
  });
  // The tables as the item pages say they should be.
  const tables = (extra: Record<string, RawTraitMember[]> = {}): RawEquipmentTraits => ({
    title: "Equipment Traits",
    categories: [],
    listed: traits.map((trait) => ({ name: trait.name, count: 0 })),
    traits: traits.map((trait) => ({
      name: trait.name,
      anchor: new URL(trait.wiki.url).hash.slice(1),
      members: [
        ...weapons
          .filter((weapon) => weapon.traitIds.includes(trait.id))
          .map((weapon) => member(weapon.wiki.title, "Weapon")),
        ...stratagems
          .filter((stratagem) => stratagem.traitIds.includes(trait.id))
          .map((stratagem) => member(stratagem.wiki.title, "Stratagem")),
        ...(extra[trait.id] ?? []),
      ],
    })),
  });

  it("finds nothing when the tables and the item pages agree", () => {
    expect(checkTraitTables(dataset, tables())).toEqual([]);
  });

  it("warns about rows without an item or a trait link, and links without a row", () => {
    const page = tables({
      explosive: [member("40-K Meltagun", "Stratagem"), member("AR-99 Unreleased", "Weapon")],
      orbital: [member("Trench Shovel", "Weapon", "OPS")],
    });
    const orbital = page.traits.find((trait) => trait.name === "Orbital");
    orbital?.members.splice(0, 1); // Orbital Precision Strike
    expect(checkTraitTables(dataset, page)).toEqual([
      "stratagems/40-k-meltagun: listed under Explosive on Equipment Traits, its page does not link it",
      'weapon-traits/explosive: "AR-99 Unreleased" (Weapon) matches 0 weapons',
      'weapon-traits/orbital: "Trench Shovel" (Weapon) matches 0 weapons',
      "stratagems/orbital-precision-strike: traits not listed on Equipment Traits: orbital",
    ]);
  });

  it("matches rows by in-game name and skips holder collections not in the dataset", () => {
    const renamed = weapons.map((weapon) =>
      weapon.id === "ar-23-liberator" ? { ...weapon, name: "Liberator" } : weapon,
    );
    const page = tables();
    const lap = page.traits.find((trait) => trait.name === "Light Armor Penetrating");
    const row = lap?.members.find((m) => m.page.title === "AR-23 Liberator");
    if (row) {
      row.page = { label: "Liberator (old)", title: "Liberator (old)", anchor: null };
      row.name = "Liberator";
    }
    expect(checkTraitTables({ ...dataset, weapons: renamed }, page)).toEqual([]);
    const { stratagems: _, ...withoutStratagems } = dataset;
    expect(checkTraitTables(withoutStratagems, tables())).toEqual([]);
    expect(checkTraitTables({ weapons }, tables())).toEqual([]);
  });
});
