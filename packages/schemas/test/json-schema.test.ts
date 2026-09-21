import { describe, expect, it } from "vitest";
import { jsonSchemaFiles } from "../src/json-schema.ts";

describe("jsonSchemaFiles", () => {
  const files = jsonSchemaFiles();

  it("exports one file per entity and envelope, sorted by name", () => {
    expect([...files.keys()]).toEqual([
      "armor-set.json",
      "armor.json",
      "booster.json",
      "cape.json",
      "changelog-entry.json",
      "dataset-manifest.json",
      "emote.json",
      "helmet.json",
      "meta.json",
      "passive.json",
      "pattern.json",
      "player-card.json",
      "problem.json",
      "stratagem.json",
      "title.json",
      "warbond.json",
      "weapon-trait.json",
      "weapon.json",
    ]);
  });

  it("identifies each document and keeps objects open for additive changes", () => {
    const booster = JSON.parse(files.get("booster.json") ?? "{}");

    expect(booster).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://helldivers-api.dionatha.com.br/v1/schemas/booster.json",
      title: "booster",
      type: "object",
    });
    expect(booster.required).toEqual([
      "id",
      "slug",
      "name",
      "upcoming",
      "aliases",
      "description",
      "image",
      "wiki",
      "effect",
      "source",
    ]);
    for (const text of files.values()) {
      expect(text).not.toContain('"additionalProperties": false');
    }
  });

  it("is deterministic", () => {
    expect(jsonSchemaFiles()).toEqual(files);
  });
});
