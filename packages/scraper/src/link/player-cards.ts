import type { Dataset } from "@hd2/schemas";

// Cape ⇄ player card (arch §5.5 rule 9): `cape.playerCardId` is the card paired with the cape.
// The player-cards pipeline sets `pairedCapeId` from the shared page; this step mirrors it on
// the capes after every pipeline, so `--only capes` keeps the published pairs.

export function linkCapeCards(dataset: Dataset): Dataset {
  const { capes, "player-cards": cards } = dataset;
  if (!capes || !cards) {
    return dataset;
  }
  const cardOf = new Map(
    cards.flatMap((card) => (card.pairedCapeId ? [[card.pairedCapeId, card.id] as const] : [])),
  );
  return {
    ...dataset,
    capes: capes.map((cape) => ({ ...cape, playerCardId: cardOf.get(cape.id) ?? null })),
  };
}
