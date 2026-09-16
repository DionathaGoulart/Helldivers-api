import { join } from "node:path";
import type { Cape, Dataset, PlayerCard } from "@hd2/schemas";
import { checkIntegrity } from "@hd2/schemas";
import { readDatasetFiles } from "@hd2/schemas/node";
import { describe, expect, it } from "vitest";
import { linkCapeCards } from "../../src/link/player-cards.ts";

// Synthetic data/v1 of packages/schemas: Camo Cloak and City Fighter's Resolve, each a cape paired
// with the player card of its page.
const { files } = await readDatasetFiles(
  join(import.meta.dirname, "..", "..", "..", "schemas", "test", "dataset"),
);
const list = <T>(collection: string) => (files.get(`${collection}.json`) as { data: T[] }).data;
const capes = list<Cape>("capes");
const cards = list<PlayerCard>("player-cards");

const pairIssues = (dataset: Dataset) =>
  checkIntegrity(dataset).filter((issue) => ["playerCardId", "pairedCapeId"].includes(issue.field));

describe("linkCapeCards", () => {
  const cleared: Dataset = {
    capes: capes.map((cape) => ({ ...cape, playerCardId: null })),
    "player-cards": cards,
  };

  it("sets cape.playerCardId to the card paired with the cape", () => {
    expect(capes.every((cape) => cape.playerCardId !== null)).toBe(true);
    const linked = linkCapeCards(cleared);
    expect(linked.capes).toEqual(capes);
    expect(pairIssues(linked)).toEqual([]);
  });

  it("clears a pair the cards no longer name", () => {
    const [first, ...rest] = cards;
    const unpaired = first ? [{ ...first, pairedCapeId: null }, ...rest] : rest;
    const linked = linkCapeCards({ capes, "player-cards": unpaired });
    expect(linked.capes?.find((cape) => cape.id === first?.id)?.playerCardId).toBeNull();
    expect(pairIssues(linked)).toEqual([]);
  });

  it("keeps the published pairs without player cards", () => {
    expect(linkCapeCards({ capes: cleared.capes ?? [] })).toEqual({ capes: cleared.capes });
  });
});
