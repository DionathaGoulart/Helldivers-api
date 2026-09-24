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
import { quarantine } from "../../src/publish/quarantine.ts";

// Synthetic data/v1 of packages/schemas as the published dataset; each test breaks a copy.
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
const entity = <C extends Collection>(dataset: Dataset, collection: C, id: string) =>
  (dataset[collection] as CollectionEntity<C>[] | undefined)?.find((e) => e.id === id);
const BOOSTER = "hellpod-space-optimization";

describe("quarantine", () => {
  it("returns a sound dataset as it is", () => {
    const dataset = load();
    expect(quarantine(dataset, load())).toEqual({ dataset, quarantined: [], issues: [] });
  });

  it("keeps the published version of an entity the wiki contradicts itself about", () => {
    const published = load();
    const dataset = load();
    const booster = entity(dataset, "boosters", BOOSTER);
    if (!booster) throw new Error("missing booster");
    booster.source.page = 2;
    booster.description = "Fresh text from this run.";

    const { dataset: held, quarantined, issues } = quarantine(dataset, published);
    expect(quarantined).toEqual([
      {
        collection: "boosters",
        id: BOOSTER,
        action: "kept-published",
        reasons: [
          `source.page: warbonds/helldivers-mobilize page 2 does not list boosters/${BOOSTER}`,
        ],
      },
    ]);
    expect(entity(held, "boosters", BOOSTER)).toEqual(entity(published, "boosters", BOOSTER));
    expect(issues).toEqual([]);
  });

  it("holds a new entity back, and then whatever refers to it", () => {
    const published = load();
    published.boosters = [];
    const dataset = load();
    const booster = entity(dataset, "boosters", BOOSTER);
    if (!booster) throw new Error("missing booster");
    booster.source.page = 2;

    const { dataset: held, quarantined, issues } = quarantine(dataset, published);
    expect(quarantined.map(({ collection, id, action }) => [collection, id, action])).toEqual([
      ["boosters", BOOSTER, "held-back"],
      ["warbonds", "helldivers-mobilize", "kept-published"],
    ]);
    expect(held.boosters).toEqual([]);
    // The published warbond still lists the booster: nothing fixes that, validation fails.
    expect(issues).toEqual(checkIntegrity(held));
    expect(issues.map((issue) => `${issue.collection}/${issue.id}`)).toContain(
      "warbonds/helldivers-mobilize",
    );
  });

  it("gives up past the limit, leaving the dataset as scraped", () => {
    const dataset = load();
    for (const booster of dataset.boosters ?? []) booster.source.page = 2;
    const { dataset: held, quarantined, issues } = quarantine(dataset, load(), 0);
    expect([held, quarantined]).toEqual([dataset, []]);
    expect(issues).toHaveLength(1);
  });
});
