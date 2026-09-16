import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CollectionEntity, collectionSchemas } from "../src/collections.ts";
import { Collection } from "../src/common.ts";
import { List } from "../src/envelope.ts";
import { checkIntegrity, type Dataset } from "../src/integrity.ts";

const datasetDir = join(import.meta.dirname, "dataset");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function loadDataset(): Dataset {
  const entries = Collection.options.map((collection) => [
    collection,
    List(collectionSchemas[collection]).parse(readJson(join(datasetDir, `${collection}.json`)))
      .data,
  ]);
  return Object.fromEntries(entries) as Dataset;
}

const manifest = readJson(join(datasetDir, "reports", "images.json")) as {
  images: { url: string }[];
};
const imageUrls = new Set(manifest.images.map((image) => image.url));

function entity<C extends Collection>(
  dataset: Dataset,
  collection: C,
  id: string,
): CollectionEntity<C> {
  const found = (dataset[collection] as readonly CollectionEntity<C>[] | undefined)?.find(
    (candidate) => candidate.id === id,
  );
  if (!found) {
    throw new Error(`missing ${collection}/${id}`);
  }
  return found;
}

const castellansItem = (dataset: Dataset, page: number, item: number) => {
  const found = entity(dataset, "warbonds", "castellans-creed").pages[page]?.items[item];
  if (!found?.ref) {
    throw new Error(`missing castellans-creed page ${page} item ${item}`);
  }
  return found.ref;
};

describe("checkIntegrity", () => {
  it("passes on the synthetic dataset", () => {
    expect(checkIntegrity(loadDataset(), { imageUrls })).toEqual([]);
  });

  it("reports a dangling passiveId", () => {
    const dataset = loadDataset();
    entity(dataset, "armors", "tg-8-sharpshooter").passiveId = "iron-lungs";

    expect(checkIntegrity(dataset)).toEqual([
      {
        collection: "armors",
        id: "tg-8-sharpshooter",
        field: "passiveId",
        message: "passives/iron-lungs does not exist",
      },
      {
        collection: "passives",
        id: "true-grit",
        field: "armorIds",
        message: "lists armors/tg-8-sharpshooter, which does not reference passives/true-grit",
      },
    ]);
  });

  it("accepts refs into a missing collection whose ids are known (warbond stubs)", () => {
    const dataset = loadDataset();
    delete dataset.warbonds;
    const warbonds = new Set(["castellans-creed", "helldivers-mobilize", "viper-commandos"]);

    expect(checkIntegrity(dataset, { knownIds: { warbonds } })).toEqual([]);

    warbonds.delete("viper-commandos");
    const issues = checkIntegrity(dataset, { knownIds: { warbonds } });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.message)).toEqual(
      issues.map(() => "warbonds/viper-commandos does not exist"),
    );
  });

  it("reports refs into a collection missing from the dataset", () => {
    const dataset = loadDataset();
    delete dataset.passives;

    expect(checkIntegrity(dataset).map((issue) => `${issue.id} ${issue.field}`)).toEqual([
      "tg-122-demo-trooper passiveId",
      "tg-8-sharpshooter passiveId",
    ]);
  });

  it("reports duplicate ids", () => {
    const dataset = loadDataset();
    const booster = entity(dataset, "boosters", "hellpod-space-optimization");
    dataset.boosters = [booster, booster];

    expect(checkIntegrity(dataset)).toEqual([
      { collection: "boosters", id: booster.id, field: "id", message: "duplicate id" },
    ]);
  });

  describe("warbonds", () => {
    it("reports an item ref to a missing entity and the entity it no longer lists", () => {
      const dataset = loadDataset();
      castellansItem(dataset, 0, 4).id = "r-40-k-hot-shot-rifle";

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "warbonds",
          id: "castellans-creed",
          field: "pages[0].items[4].ref.id",
          message: "weapons/r-40-k-hot-shot-rifle does not exist",
        },
        {
          collection: "weapons",
          id: "r-40-k-hot-shot-marksman-rifle",
          field: "source.page",
          message:
            "warbonds/castellans-creed page 1 does not list weapons/r-40-k-hot-shot-marksman-rifle",
        },
      ]);
    });

    it("requires pattern refs to name an existing variant", () => {
      const dataset = loadDataset();
      castellansItem(dataset, 1, 2).variant = "weapon";

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "warbonds",
          id: "castellans-creed",
          field: "pages[1].items[2].ref.variant",
          message: "patterns/castellans-green has no weapon variant",
        },
        {
          collection: "patterns",
          id: "castellans-green",
          field: "variants[1].source.page",
          message:
            "warbonds/castellans-creed page 2 does not list patterns/castellans-green (shuttle)",
        },
      ]);
    });

    it("allows variants only on pattern refs", () => {
      const dataset = loadDataset();
      castellansItem(dataset, 0, 5).variant = null;
      castellansItem(dataset, 0, 1).variant = "hellpod";

      expect(checkIntegrity(dataset).map((issue) => `${issue.field}: ${issue.message}`)).toEqual([
        "pages[0].items[1].ref.variant: variant is only allowed on pattern refs",
        "pages[0].items[5].ref.variant: pattern refs need a variant",
        "variants[0].source.page: warbonds/castellans-creed page 1 does not list patterns/castellans-green (hellpod)",
      ]);
    });

    it("requires pages numbered from 1", () => {
      const dataset = loadDataset();
      const page = entity(dataset, "warbonds", "viper-commandos").pages[2];
      if (page) page.number = 4;

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "warbonds",
          id: "viper-commandos",
          field: "pages[2].number",
          message: "expected page 3, got 4",
        },
        {
          collection: "titles",
          id: "viper-commando",
          field: "source.page",
          message: "warbonds/viper-commandos page 3 does not list titles/viper-commando",
        },
      ]);
    });
  });

  describe("sources", () => {
    it("reports a missing warbond", () => {
      const dataset = loadDataset();
      entity(dataset, "emotes", "clapping").source.warbondId = "helldivers-mobilise";

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "emotes",
          id: "clapping",
          field: "source.warbondId",
          message: "warbonds/helldivers-mobilise does not exist",
        },
      ]);
    });

    it("reports a page beyond the warbond", () => {
      const dataset = loadDataset();
      entity(dataset, "helmets", "tg-8-sharpshooter").source.page = 4;

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "helmets",
          id: "tg-8-sharpshooter",
          field: "source.page",
          message: "warbonds/castellans-creed has 3 pages",
        },
      ]);
    });

    it("reports a cost that differs from the warbond page", () => {
      const dataset = loadDataset();
      const { source } = entity(dataset, "helmets", "tg-8-sharpshooter");
      source.cost = { currency: "medals", amount: 39 };

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "helmets",
          id: "tg-8-sharpshooter",
          field: "source.cost",
          message:
            "warbonds/castellans-creed page 1 lists helmets/tg-8-sharpshooter for 30 medals, source says 39 medals",
        },
      ]);
    });

    it("accepts a cost not announced on either side, and only on both", () => {
      const dataset = loadDataset();
      const { source } = entity(dataset, "helmets", "tg-8-sharpshooter");
      source.cost = null;

      expect(checkIntegrity(dataset).map((issue) => issue.message)).toEqual([
        "warbonds/castellans-creed page 1 lists helmets/tg-8-sharpshooter for 30 medals, source says no cost",
      ]);

      const listed = entity(dataset, "warbonds", "castellans-creed").pages[0]?.items[2];
      if (!listed) throw new Error("missing castellans-creed page 1 item 3");
      listed.cost = null;
      expect(checkIntegrity(dataset)).toEqual([]);
    });
  });

  describe("back-references", () => {
    it("requires weapon traits to mirror traitIds", () => {
      const dataset = loadDataset();
      const shotgun = entity(dataset, "weapons", "sg-88-break-action-shotgun");
      shotgun.traitIds = shotgun.traitIds.filter((id) => id !== "rounds-reload");

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "weapon-traits",
          id: "rounds-reload",
          field: "weaponIds",
          message:
            "lists weapons/sg-88-break-action-shotgun, which does not reference weapon-traits/rounds-reload",
        },
      ]);
    });

    it("requires every armor in exactly one set", () => {
      const dataset = loadDataset();
      const alternate = {
        ...entity(dataset, "armor-sets", "tg-8-sharpshooter"),
        id: "tg-8-sharpshooter-alt",
        slug: "tg-8-sharpshooter-alt",
        capeId: null,
        capeLink: null,
      };
      dataset["armor-sets"] = [...(dataset["armor-sets"] ?? []), alternate];

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "armors",
          id: "tg-8-sharpshooter",
          field: "setIds",
          message: "must be in exactly one armor set, found 2",
        },
        {
          collection: "armors",
          id: "tg-8-sharpshooter",
          field: "setIds",
          message:
            "missing armor-sets/tg-8-sharpshooter-alt, which references armors/tg-8-sharpshooter",
        },
        {
          collection: "helmets",
          id: "tg-8-sharpshooter",
          field: "setIds",
          message:
            "missing armor-sets/tg-8-sharpshooter-alt, which references helmets/tg-8-sharpshooter",
        },
      ]);
    });

    it("requires capeLink exactly when a cape is linked", () => {
      const dataset = loadDataset();
      entity(dataset, "armor-sets", "tg-122-demo-trooper").capeLink = null;

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "armor-sets",
          id: "tg-122-demo-trooper",
          field: "capeLink",
          message: "capeLink is set exactly when capeId is",
        },
      ]);
    });

    it("requires capes and player cards to pair both ways", () => {
      const dataset = loadDataset();
      entity(dataset, "player-cards", "camo-cloak").pairedCapeId = "city-fighters-resolve";

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "capes",
          id: "camo-cloak",
          field: "playerCardId",
          message: "player-cards/camo-cloak is not paired with this cape",
        },
        {
          collection: "player-cards",
          id: "camo-cloak",
          field: "pairedCapeId",
          message: "capes/city-fighters-resolve is not paired with this card",
        },
      ]);
    });
  });

  describe("images", () => {
    it("reports images missing from the upload manifest", () => {
      const dataset = loadDataset();
      const url = entity(dataset, "boosters", "hellpod-space-optimization").image?.url ?? "";
      const partial = new Set([...imageUrls].filter((candidate) => candidate !== url));

      expect(checkIntegrity(dataset, { imageUrls: partial })).toEqual([
        {
          collection: "boosters",
          id: "hellpod-space-optimization",
          field: "image.url",
          message: "not in the image upload manifest",
        },
      ]);
    });

    it("reports image keys outside the entity's collection and id", () => {
      const dataset = loadDataset();
      const { image } = entity(dataset, "patterns", "arctic");
      if (image) image.url = "/images/v1/patterns/arctics.06a4f492.webp";

      expect(checkIntegrity(dataset)).toEqual([
        {
          collection: "patterns",
          id: "arctic",
          field: "image.url",
          message: "expected a key under /images/v1/patterns/arctic",
        },
      ]);
    });
  });
});
