import { join } from "node:path";
import type { WeaponTrait } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { traitResolver } from "../../src/collections/item-source.ts";

// Synthetic data/v1 of packages/schemas.
const { files } = await readDatasetFiles(
  join(import.meta.dirname, "..", "..", "..", "schemas", "test", "dataset"),
);
const traits = (files.get("weapon-traits.json") as { data: WeaponTrait[] }).data;

const link = (anchor: string) => ({
  label: anchor,
  title: "Equipment Traits",
  anchor,
});

describe("traitResolver", () => {
  const [trait] = traits;
  const anchor = decodeURIComponent(new URL(trait?.wiki.url ?? "").hash.slice(1));

  it("resolves trait links by heading anchor", () => {
    const resolve = traitResolver(traits, "weapons", {});
    expect(resolve([link(anchor), link(anchor)], "page")).toEqual([trait?.id]);
    expect(() => resolve([link("Anti_Tank")], "page")).toThrow("unknown equipment trait");
  });

  it("resolves a misspelled heading to the trait it is aliased to", () => {
    const resolve = traitResolver(traits, "weapons", { Anti_Tank: trait?.id ?? "" });
    expect(resolve([link("Anti_Tank"), link(anchor)], "page")).toEqual([trait?.id]);
  });

  it("fails on an alias for a trait that does not exist", () => {
    expect(() => traitResolver(traits, "weapons", { Anti_Tank: "no-such-trait" })).toThrow(
      'data/overrides/trait-aliases.json: "Anti_Tank" is not a trait id: no-such-trait',
    );
  });
});
