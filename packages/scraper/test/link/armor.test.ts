import { join } from "node:path";
import type { Armor, ArmorSet, Cape, Dataset, Helmet, Passive } from "@hd2/schemas";
import { checkIntegrity } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { linkSetParts } from "../../src/link/armor-sets.ts";
import { linkPassiveArmors } from "../../src/link/passives.ts";

// Synthetic data/v1 of packages/schemas: two armor sets, each with a cape, sharing True Grit.
const { files } = await readDatasetFiles(
  join(import.meta.dirname, "..", "..", "..", "schemas", "test", "dataset"),
);
const list = <T>(collection: string) => (files.get(`${collection}.json`) as { data: T[] }).data;
const armors = list<Armor>("armors");
const helmets = list<Helmet>("helmets");
const capes = list<Cape>("capes");
const sets = list<ArmorSet>("armor-sets");
const passives = list<Passive>("passives");

// Integrity issues of the linked fields only: sources and passives dangle in this partial dataset.
const issuesOf = (dataset: Dataset, fields: readonly string[]) =>
  checkIntegrity(dataset).filter((issue) => fields.includes(issue.field));

describe("linkSetParts", () => {
  const cleared: Dataset = {
    "armor-sets": sets,
    armors: armors.map((armor) => ({ ...armor, setIds: ["stale"] })),
    helmets: helmets.map((helmet) => ({ ...helmet, setIds: [] })),
    capes: capes.map((cape) => ({ ...cape, setIds: [] })),
  };

  it("rebuilds armor, helmet and cape setIds as the inverse of the sets", () => {
    const linked = linkSetParts(cleared);
    expect(linked.armors).toEqual(armors);
    expect(linked.helmets).toEqual(helmets);
    expect(linked.capes).toEqual(capes);
    expect(issuesOf(linked, ["setIds", "armorId", "helmetId", "capeId"])).toEqual([]);
  });

  it("keeps the lists when there are no sets and skips absent parts", () => {
    const { "armor-sets": _, ...withoutSets } = cleared;
    expect(linkSetParts(withoutSets)).toEqual(withoutSets);
    const linked = linkSetParts({ "armor-sets": sets, armors: cleared.armors ?? [] });
    expect(linked.armors).toEqual(armors);
    expect(linked).not.toHaveProperty("helmets");
  });
});

describe("linkPassiveArmors", () => {
  const cleared: Dataset = {
    passives: passives.map((passive) => ({ ...passive, armorIds: [] })),
    armors,
  };

  it("rebuilds armorIds as the inverse of armor.passiveId", () => {
    const linked = linkPassiveArmors(cleared);
    expect(linked.passives).toEqual(passives);
    expect(issuesOf(linked, ["armorIds"])).toEqual([]);
  });

  it("keeps the published lists without armors", () => {
    const { armors: _, ...withoutArmors } = cleared;
    expect(linkPassiveArmors(withoutArmors)).toEqual(withoutArmors);
  });
});
