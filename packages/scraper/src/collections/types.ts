import type { Collection, CollectionEntity, Conflict, Dataset, IdLock } from "@hd2/schemas";
import type { Logger } from "../log.ts";
import type { WarbondResolver } from "../normalize/warbonds.ts";
import type { Overrides } from "../overrides.ts";
import type { WikiSource } from "../source.ts";

// One pipeline per collection: discover from its index, fetch, parse, normalize (arch §6.1 steps 2–5).

export interface ScrapeContext {
  source: WikiSource;
  overrides: Overrides;
  idLock: IdLock;
  warbonds: WarbondResolver;
  logger: Logger;
  /** Published collections merged with the ones scraped earlier in this run (reference lookups). */
  dataset: Dataset;
}

export interface ScrapeResult<C extends Collection = Collection> {
  collection: C;
  entities: CollectionEntity<C>[];
  indexCount: number; // rows on the index, for the coverage guardrail
  warnings: string[];
  conflicts: Conflict[]; // arch §5.5, written to reports/conflicts.json
}

export interface CollectionPipeline<C extends Collection = Collection> {
  collection: C;
  indexPages: readonly string[]; // checked against robots.txt in the preflight
  scrape(context: ScrapeContext): Promise<ScrapeResult<C>>;
}
