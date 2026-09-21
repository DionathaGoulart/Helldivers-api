import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectionSchemas } from "../src/collections.ts";
import { Collection } from "../src/common.ts";
import { DELETE, mutate } from "./helpers.ts";

const testDir = import.meta.dirname;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// `examples/<collection>.<id>.json`: arch §5.4 examples completed into full objects.
const examples = readdirSync(join(testDir, "examples"))
  .sort()
  .map((file) => {
    const [collection = "", id = ""] = file.slice(0, -".json".length).split(".");
    return {
      file,
      collection: Collection.parse(collection),
      id,
      value: readJson(join(testDir, "examples", file)),
    };
  });

const example = (collection: Collection, id: string): unknown => {
  const found = examples.find((e) => e.collection === collection && e.id === id);
  if (!found) throw new Error(`missing example ${collection}.${id}`);
  return structuredClone(found.value);
};

describe("arch §5.4 examples", () => {
  it("cover every collection", () => {
    expect(new Set(examples.map((e) => e.collection))).toEqual(new Set(Collection.options));
  });

  it.each(examples)("$file matches its collection schema", ({ collection, value }) => {
    const result = collectionSchemas[collection].safeParse(value);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(examples)(
    "$file equals its item in the synthetic dataset",
    ({ collection, id, value }) => {
      const item = readJson(join(testDir, "dataset", collection, `${id}.json`));
      expect(item).toMatchObject({ data: value });
    },
  );
});

describe("mutated examples", () => {
  const issuesOf = (collection: Collection, value: unknown) =>
    collectionSchemas[collection].safeParse(value).error?.issues ?? [];

  it("reject an empty stratagem code unless the stratagem is upcoming", () => {
    const noCode = mutate(example("stratagems", "orbital-precision-strike"), ["code"], []);
    expect(issuesOf("stratagems", noCode)).toMatchObject([
      { code: "custom", path: ["code"], message: "a released stratagem needs a code" },
    ]);
    expect(issuesOf("stratagems", mutate(noCode, ["upcoming"], true))).toEqual([]);
  });

  it("reject a missing field", () => {
    const issues = issuesOf(
      "weapons",
      mutate(example("weapons", "ar-23-liberator"), ["firearm"], DELETE),
    );
    expect(issues).toMatchObject([{ code: "invalid_type", path: ["firearm"] }]);
  });

  it("reject an unknown enum value", () => {
    const armor = mutate(example("armors", "tg-8-sharpshooter"), ["weight"], "ultra");
    expect(issuesOf("armors", armor)).toMatchObject([{ code: "invalid_value", path: ["weight"] }]);
  });

  it("reject a warbond source without page", () => {
    const armor = mutate(example("armors", "tg-8-sharpshooter"), ["source", "page"], null);
    expect(issuesOf("armors", armor)).toMatchObject([
      { path: ["source"], message: "warbond source needs warbondId and page" },
    ]);
  });

  it("reject rotating on a non-superstore source", () => {
    const booster = mutate(
      example("boosters", "hellpod-space-optimization"),
      ["source", "rotating"],
      false,
    );
    expect(issuesOf("boosters", booster)).toMatchObject([
      { path: ["source"], message: "rotating is set only for superstore" },
    ]);
  });

  it("reject an emote without flags", () => {
    const emote = mutate(example("emotes", "clapping"), ["victoryPose"], false);
    expect(issuesOf("emotes", emote)).toMatchObject([{ message: "at least one flag" }]);
  });

  it("reject a pattern without variants", () => {
    const pattern = mutate(example("patterns", "castellans-green"), ["variants"], []);
    expect(issuesOf("patterns", pattern)).toMatchObject([
      { code: "too_small", path: ["variants"] },
    ]);
  });

  it("reject a string where a number is expected", () => {
    const warbond = mutate(example("warbonds", "castellans-creed"), ["medalsAllItems"], "657");
    expect(issuesOf("warbonds", warbond)).toMatchObject([
      { code: "invalid_type", path: ["medalsAllItems"] },
    ]);
  });
});
