import { join } from "node:path";
import type { Armor, ArmorSet, Cape, Dataset, Helmet, Passive, Warbond } from "@hd2/schemas";
import { checkIntegrity } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { findSetCapes, linkSetParts } from "../../src/link/armor-sets.ts";
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
const warbonds = list<Warbond>("warbonds");

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

describe("findSetCapes", () => {
  const capeOf = (set: ArmorSet) => ({ capeId: set.capeId, capeLink: set.capeLink });
  const cell = (name: string, type: string) => ({
    name,
    type,
    link: { label: name, title: name, anchor: null },
    cost: { text: "150", currency: "super_credits" as const },
  });
  const storePage = (number: number, items: ReturnType<typeof cell>[]) => ({
    number,
    items,
    set: {
      label: "Exo Experts",
      link: null,
      items: [{ text: "x", link: null, cost: { text: "1", currency: null } }],
      total: null,
    },
  });

  it("links the only armor and the only cape of a warbond page", () => {
    const found = findSetCapes({ armors, capes, warbonds, superstore: { pages: [] } });
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(sets.map((set) => [set.armorId, capeOf(set)])),
    );
  });

  it("prefers a Superstore tab with exactly one armor and one cape", () => {
    const superstore = {
      pages: [
        storePage(1, [cell("TG-122 Demo-Trooper", "Armor"), cell("Camo Cloak", "Cape")]),
        storePage(2, [
          cell("TG-8 Sharpshooter", "Armor"),
          cell("TG-122 Demo-Trooper", "Armor"),
          cell("City Fighter's Resolve", "Cape"),
        ]),
      ],
    };
    const found = findSetCapes({ armors, capes, warbonds, superstore });
    expect(found.get("tg-122-demo-trooper")).toEqual({
      capeId: "camo-cloak",
      capeLink: {
        method: "superstore_set",
        evidence:
          "Superstore page 1 (Exo Experts) stocks exactly one armor (TG-122 Demo-Trooper) and one cape (Camo Cloak)",
      },
    });
    expect(found.get("tg-8-sharpshooter")?.capeLink?.method).toBe("warbond_page");
  });

  it("links nothing when a page offers a second cape, even one without an entity", () => {
    const [castellans, ...others] = warbonds;
    if (!castellans) throw new Error("synthetic dataset without warbonds");
    const unreleased = { name: "Verdant Cloak", wikiType: "Cape", ref: null, cost: null };
    const withSecondCape = {
      ...castellans,
      pages: castellans.pages.map((page) =>
        page.number === 1 ? { ...page, items: [...page.items, unreleased] } : page,
      ),
    };
    const found = findSetCapes({
      armors,
      capes,
      warbonds: [withSecondCape, ...others],
      superstore: { pages: [] },
    });
    expect([...found.keys()]).toEqual(["tg-122-demo-trooper"]);
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
