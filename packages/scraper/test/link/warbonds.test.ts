import { join } from "node:path";
import {
  type Collection,
  type CollectionEntity,
  checkIntegrity,
  collectionSchemas,
  type Dataset,
  List,
} from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { NormalizeError } from "../../src/errors.ts";
import { checkSuperstoreSources } from "../../src/link/superstore.ts";
import {
  collectionsOfType,
  linkWarbondCosts,
  WarbondRefIndex,
} from "../../src/link/warbond-items.ts";
import type { RawSuperstore } from "../../src/parsers/superstore.ts";

// Synthetic data/v1 of packages/schemas: Castellan's Creed with its §5.4 items, whose tables add
// up to "All Items Unlocked" (657) with the TG-8 Sharpshooter helmet at 30.
const { files } = await readDatasetFiles(
  join(import.meta.dirname, "..", "..", "..", "schemas", "test", "dataset"),
);
const load = (): Dataset => {
  const dataset: Record<string, unknown> = {};
  for (const file of files.keys()) {
    const collection = file.replace(/\.json$/, "") as Collection;
    if (collection in collectionSchemas) {
      dataset[collection] = List(collectionSchemas[collection]).parse(files.get(file)).data;
    }
  }
  return dataset as Dataset;
};
const entity = <C extends Collection>(dataset: Dataset, collection: C, id: string) => {
  const found = (dataset[collection] as CollectionEntity<C>[] | undefined)?.find(
    (e) => e.id === id,
  );
  if (!found) throw new Error(`missing ${collection}/${id}`);
  return found;
};
const helmetRow = (dataset: Dataset) => {
  const row = entity(dataset, "warbonds", "castellans-creed").pages[0]?.items[2];
  if (row?.ref?.collection !== "helmets") throw new Error("missing the TG-8 helmet row");
  return row;
};
const medals = (amount: number) => ({ currency: "medals" as const, amount });
const PAGE = "https://helldivers.wiki.gg/wiki/Castellan's_Creed_Legendary_Warbond";

describe("WarbondRefIndex", () => {
  const index = new WarbondRefIndex(load());
  const refOf = (name: string, wikiType: string, title: string | null) => {
    const row = { name, wikiType, link: title === null ? null : { title } };
    return WarbondRefIndex.refOf(row, index.candidates(row), PAGE);
  };

  it("matches by link and narrows pages shared by armor, helmet, cape and card by type", () => {
    expect(refOf("TG-8 Sharpshooter", "Medium Armor", "TG-8 Sharpshooter")).toEqual({
      collection: "armors",
      id: "tg-8-sharpshooter",
      variant: null,
    });
    expect(refOf("TG-8 Sharpshooter", "Helmet", "TG-8 Sharpshooter").collection).toBe("helmets");
    expect(refOf("Camo Cloak", "Player Card", "Camo Cloak").collection).toBe("player-cards");
    expect(
      refOf("R/40-K Hot-Shot Marksman Rifle", "Marksman Rifle", "R/40-K Hot-Shot Marksman Rifle"),
    ).toEqual({ collection: "weapons", id: "r-40-k-hot-shot-marksman-rifle", variant: null });
    // Curly apostrophes and quotes match their straight form.
    expect(refOf("City Fighter’s Resolve", "Cape", "City Fighter’s Resolve").id).toBe(
      "city-fighters-resolve",
    );
  });

  it("matches rows without a link by name, and pattern variants by suffix (rule 10)", () => {
    expect(refOf("Still Standing", "Title", null)).toEqual({
      collection: "titles",
      id: "still-standing",
      variant: null,
    });
    expect(refOf("Castellans Green Shuttle", "Pattern", "Castellans Green Pattern")).toEqual({
      collection: "patterns",
      id: "castellans-green",
      variant: "shuttle",
    });
    expect(() => refOf("Castellans Green", "Pattern", "Castellans Green Pattern")).toThrow(
      "pattern row without a Hellpod/Shuttle/Exosuit/Vehicle suffix",
    );
  });

  it("finds nothing for currency rows, other types or index anchors", () => {
    const row = (name: string, wikiType: string, title: string) => ({
      name,
      wikiType,
      link: { title },
    });
    expect(collectionsOfType("Currency")).toBeNull();
    expect(index.covers(row("100 Super Credits", "Currency", "Super Credits"))).toBe(false);
    expect(index.candidates(row("TG-8 Sharpshooter", "Cape", "TG-8 Sharpshooter"))).toEqual([]);
    // Weapon patterns point at `Cosmetics#Patterns`, which names none of them.
    expect(index.candidates(row("Arctic", "Pattern", "Cosmetics"))).toEqual([]);
    expect(collectionsOfType("Backpack Weapon")).toEqual(["weapons", "stratagems"]);
  });

  it("fails on a row two entities could be", () => {
    const dataset = load();
    const [first, second] = dataset.weapons ?? [];
    if (!first || !second) throw new Error("need two weapons");
    const twins = new WarbondRefIndex({
      weapons: [first, { ...second, aliases: [first.wiki.title] }],
    });
    const row = { name: "Twin", wikiType: "Assault Rifle", link: { title: first.wiki.title } };
    expect(() => WarbondRefIndex.refOf(row, twins.candidates(row), PAGE)).toThrow(NormalizeError);
  });
});

describe("linkWarbondCosts (rule 1)", () => {
  const castellans = (conflicts: { id: string }[]) =>
    conflicts.filter((conflict) => conflict.id === "castellans-creed");
  const costIssues = (dataset: Dataset) =>
    checkIntegrity(dataset).filter((issue) => issue.field.endsWith("cost"));

  it("keeps the item's price when the table's does not add up (TG-8 helmet 39 → 30)", () => {
    const dataset = load();
    helmetRow(dataset).cost = medals(39);

    const { dataset: linked, conflicts, warnings } = linkWarbondCosts(dataset, { scraped: true });
    expect(helmetRow(linked).cost).toEqual(medals(30));
    expect(entity(linked, "helmets", "tg-8-sharpshooter").source.cost).toEqual(medals(30));
    expect(helmetRow(dataset).cost).toEqual(medals(39)); // the input is not modified
    expect(castellans(conflicts)).toEqual([
      {
        collection: "warbonds",
        id: "castellans-creed",
        field: "pages[0].items[2].cost",
        rule: 1,
        chosen: medals(30),
        candidates: [
          { page: PAGE, location: "Page 1 › TG-8 Sharpshooter", value: medals(39) },
          {
            page: "https://helldivers.wiki.gg/wiki/TG-8_Sharpshooter",
            location: "helmets/tg-8-sharpshooter › source",
            value: medals(30),
          },
        ],
      },
    ]);
    expect(warnings).toEqual([]);
    expect(costIssues(linked)).toEqual([]);
  });

  it("takes the table's price when the tables add up with it", () => {
    const dataset = load();
    entity(dataset, "helmets", "tg-8-sharpshooter").source.cost = medals(39);

    const { dataset: linked, conflicts } = linkWarbondCosts(dataset, { scraped: true });
    expect(entity(linked, "helmets", "tg-8-sharpshooter").source.cost).toEqual(medals(30));
    expect(castellans(conflicts)).toMatchObject([{ chosen: medals(30) }]);
    expect(costIssues(linked)).toEqual([]);
  });

  it("warns when the page tables do not add up to All Items Unlocked", () => {
    const dataset = load();
    entity(dataset, "warbonds", "castellans-creed").medalsAllItems = 700;

    const { conflicts, warnings } = linkWarbondCosts(dataset, { scraped: true });
    expect(warnings).toEqual([
      "warbonds/castellans-creed: page tables add up to 657 medals, All Items Unlocked says 700",
    ]);
    expect(castellans(conflicts)).toMatchObject([
      { field: "medalsAllItems", rule: 1, chosen: 700 },
    ]);
  });

  it("gives entities the published prices when the warbonds were not scraped", () => {
    const dataset = load();
    entity(dataset, "helmets", "tg-8-sharpshooter").source.cost = medals(39);

    const { dataset: linked, conflicts, warnings } = linkWarbondCosts(dataset, { scraped: false });
    expect(entity(linked, "helmets", "tg-8-sharpshooter").source.cost).toEqual(medals(30));
    expect([conflicts, warnings]).toEqual([[], []]);
  });

  it("does nothing without warbonds", () => {
    const { warbonds: _, ...dataset } = load();
    expect(linkWarbondCosts(dataset, { scraped: false }).dataset).toBe(dataset);
  });
});

describe("checkSuperstoreSources (rule 5)", () => {
  const store = (name: string, type: string | null, price: string): RawSuperstore => ({
    pages: [
      {
        number: 1,
        items: [
          {
            name,
            type,
            link: { label: name, title: name, anchor: null },
            cost: { text: price, currency: "super_credits" },
          },
        ],
        set: { label: "Set", link: null, items: [], total: null },
      },
    ],
  });

  it("accepts a stocked item sourced from the Superstore at the stock price", () => {
    const dataset = load();
    entity(dataset, "capes", "camo-cloak").source = {
      type: "superstore",
      label: "Superstore",
      warbondId: null,
      page: null,
      cost: { currency: "super_credits", amount: 100 },
      rotating: false,
    };
    expect(checkSuperstoreSources(dataset, store("Camo Cloak", "Cape", "100"))).toEqual([]);
  });

  it("warns about other sources, other prices, unknown types and unstocked entities", () => {
    const dataset = load();
    expect(checkSuperstoreSources(dataset, store("TG-8 Sharpshooter", "Helmet", "125"))).toEqual([
      'helmets/tg-8-sharpshooter: Superstore page 1 "TG-8 Sharpshooter" (Helmet) sells it for 125 SC, source says warbond (30 medals)',
    ]);
    expect(checkSuperstoreSources(dataset, store("Arctic", "Pattern", "50"))).toEqual([
      'Superstore page 1 "Arctic" (Pattern): unknown item type',
    ]);
    entity(dataset, "capes", "camo-cloak").source = {
      type: "superstore",
      label: "Superstore",
      warbondId: null,
      page: null,
      cost: { currency: "super_credits", amount: 100 },
      rotating: false,
    };
    expect(checkSuperstoreSources(dataset, store("G/40-K Melta Mine", null, "300"))).toEqual([
      'weapons/g-40-k-melta-mine: Superstore page 1 "G/40-K Melta Mine" sells it for 300 SC, source says warbond (50 medals)',
      "capes/camo-cloak: sourced from the Superstore but not in its stock",
    ]);
  });
});
