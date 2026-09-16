import { join } from "node:path";
import type { Collection, IdLock } from "@hd2/schemas";
import { validateDataset } from "@hd2/schemas";
import { readIdLock, writeIdLock } from "@hd2/schemas/node";
import { selectPipelines } from "./collections/index.ts";
import type { ScrapeResult } from "./collections/types.ts";
import { ACCEPTED_CONTENT_SIGNALS } from "./config.ts";
import { NormalizeError, ParseError } from "./errors.ts";
import { BlockedError } from "./http/block-detect.ts";
import type { HttpClient } from "./http/client.ts";
import { checkRobots, parseRobots, RobotsChangedError } from "./http/robots.ts";
import { linkSetParts } from "./link/armor-sets.ts";
import { linkPassiveArmors } from "./link/passives.ts";
import { linkCapeCards } from "./link/player-cards.ts";
import { scrapeKeepingIds } from "./link/renames.ts";
import { checkTraitTables, linkTraitHolders } from "./link/traits.ts";
import { linkWarbondCosts } from "./link/warbond-items.ts";
import type { Logger } from "./log.ts";
import { WarbondResolver } from "./normalize/warbonds.ts";
import { idLockPath, readOverrides } from "./overrides.ts";
import { EQUIPMENT_TRAITS_INDEX, parseEquipmentTraits } from "./parsers/equipment-traits.ts";
import { archiveEntries, buildEntry, prependEntry } from "./publish/changelog.ts";
import { CONFLICTS_FILE, mergeConflicts } from "./publish/conflicts.ts";
import {
  datasetHash,
  isoDate,
  isoSeconds,
  readCurrentDataset,
  renderDataset,
  withCollection,
} from "./publish/dataset.ts";
import { diffDatasets } from "./publish/diff.ts";
import { checkGuardrails, type GuardrailCheck } from "./publish/guardrails.ts";
import type { FailureKind, RunReport } from "./publish/report.ts";
import { writeDataset } from "./publish/write.ts";
import { MemoSource, MissingFixtureError, type WikiSource } from "./source.ts";
import { wikiUrl } from "./wiki/title.ts";

// arch §6.1: preflight → scrape → guardrails → validate → stage + swap. All or nothing (ADR-005).

export interface RunOptions {
  dataDir: string; // holds v1/ and overrides/
  source: WikiSource;
  http: HttpClient | null; // online runs: robots policy and request stats
  only: readonly Collection[] | null;
  allowDrop: boolean;
  fullRefresh: boolean;
  baseUrl: string;
  userAgent: string;
  now: () => Date;
  logger: Logger;
}

class RunFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    readonly messages: readonly string[],
  ) {
    super(messages.join("; "));
    this.name = "RunFailure";
  }
}

function classify(error: unknown): RunFailure {
  if (error instanceof RunFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RobotsChangedError) return new RunFailure("robots-changed", error.reasons);
  if (error instanceof BlockedError) return new RunFailure("blocked", [message]);
  if (
    error instanceof ParseError ||
    error instanceof NormalizeError ||
    error instanceof MissingFixtureError
  ) {
    return new RunFailure("parser-broken", [message]);
  }
  return new RunFailure("error", [message]);
}

const GUARDRAIL_PRIORITY: readonly GuardrailCheck[] = ["empty", "count-drop", "index-coverage"];

export async function runScrape(options: RunOptions): Promise<RunReport> {
  const { dataDir, logger } = options;
  const source = new MemoSource(options.source);
  const started = options.now();
  const report: RunReport = {
    ok: false,
    changed: false,
    date: isoDate(started),
    mode: source.offline ? "offline" : "online",
    fullRefresh: options.fullRefresh,
    dataVersion: null,
    counts: [],
    changes: [],
    warnings: [],
    failure: null,
    http: null,
    durationMs: 0,
  };

  try {
    // 1. Preflight: robots.txt allows the planned index pages and Content-Signal is unchanged.
    const pipelines = selectPipelines(options.only);
    const robotsTxt = await source.robotsTxt();
    const policy = parseRobots(
      new URL("/robots.txt", options.baseUrl).href,
      robotsTxt,
      options.userAgent,
    );
    checkRobots(policy, {
      acceptedSignals: ACCEPTED_CONTENT_SIGNALS,
      plannedUrls: pipelines.flatMap((pipeline) =>
        pipeline.indexPages.map((title) => wikiUrl(title)),
      ),
    });
    options.http?.useRobots(policy);

    // Inputs: overrides, id lock and the dataset currently published.
    const overrides = await readOverrides(dataDir);
    const locked = await readIdLock(idLockPath(dataDir));
    const lockBefore = locked.serialize();
    const current = await readCurrentDataset(join(dataDir, "v1"));
    const warbonds = new WarbondResolver({ aliases: overrides.warbondAliases });

    // 2–5. Discover, fetch, parse, normalize; again when a renamed page would change an id (rule 8).
    const scrapeAll = async (idLock: IdLock) => {
      const results: ScrapeResult[] = [];
      let dataset = current.collections;
      for (const pipeline of pipelines) {
        logger.info("collection start", { collection: pipeline.collection });
        const result = await pipeline.scrape({
          source,
          overrides,
          idLock,
          warbonds,
          logger,
          dataset,
        });
        results.push(result);
        dataset = withCollection(dataset, result.collection, result.entities as never);
      }
      return { results, dataset };
    };
    const { output, idLock, renames } = await scrapeKeepingIds(
      source,
      locked.toJSON(),
      current.collections,
      scrapeAll,
    );
    const { results } = output;
    let next = output.dataset;
    for (const rename of renames) {
      logger.info("id kept after a rename", { ...rename });
    }
    report.warnings.push(
      ...renames.map(
        ({ collection, id, from, to }) =>
          `${collection}/${id}: "${from}" was renamed to "${to}"; the id is kept`,
      ),
      ...results.flatMap((result) => result.warnings),
    );
    // 6. Link: back-references and warbond prices (rule 1) over the merged dataset.
    const scraped = new Set(results.map((result) => result.collection));
    next = linkCapeCards(linkPassiveArmors(linkSetParts(linkTraitHolders(next))));
    const costs = linkWarbondCosts(next, { scraped: scraped.has("warbonds") });
    next = costs.dataset;
    report.warnings.push(...costs.warnings);
    // Rule 7: trait tables vs item pages, whenever either side was scraped.
    if (scraped.has("weapon-traits") || scraped.has("weapons") || scraped.has("stratagems")) {
      const traits = await source.page(EQUIPMENT_TRAITS_INDEX);
      const tables = parseEquipmentTraits(traits.html, { url: traits.url });
      report.warnings.push(...checkTraitTables(next, tables));
    }
    report.counts = results.map(({ collection, entities }) => ({
      collection,
      before: current.collections[collection]?.length ?? 0,
      after: entities.length,
    }));

    // 8. Guardrails before anything is rendered.
    const issues = checkGuardrails(
      results.map((result) => ({
        collection: result.collection,
        count: result.entities.length,
        indexCount: result.indexCount,
        previous: current.collections[result.collection]?.length ?? 0,
      })),
      { allowDrop: options.allowDrop },
    );
    if (issues.length > 0) {
      const kind = GUARDRAIL_PRIORITY.find((check) => issues.some((i) => i.check === check));
      throw new RunFailure(
        kind ?? "error",
        issues.map((issue) => issue.message),
      );
    }

    // Reports carried over, with this run's conflicts in place of the scraped collections' ones.
    const extraFiles = new Map(current.extraFiles);
    const conflicts = mergeConflicts(
      current.extraFiles.get(CONFLICTS_FILE),
      results.map((result) => result.collection),
      [...results.flatMap((result) => result.conflicts), ...costs.conflicts],
    );
    if (conflicts) {
      extraFiles.set(CONFLICTS_FILE, conflicts);
    } else {
      extraFiles.delete(CONFLICTS_FILE);
    }

    // 10. Diff; unchanged data keeps its dataVersion, so nothing is rewritten.
    report.changes = diffDatasets(current.collections, next);
    const unchanged =
      current.manifest !== null &&
      datasetHash(next) === datasetHash(current.collections) &&
      JSON.stringify(conflicts) === JSON.stringify(current.extraFiles.get(CONFLICTS_FILE) ?? null);
    let files: Map<string, unknown>;
    let archived: ReturnType<typeof prependEntry>["archived"] = [];
    if (unchanged && current.manifest) {
      report.dataVersion = current.manifest.dataVersion;
      files = renderDataset({
        dataVersion: current.manifest.dataVersion,
        generatedAt: current.manifest.generatedAt,
        collections: next,
        changelog: current.changelog,
        extraFiles,
      });
    } else {
      const dataVersion = `${report.date}.${datasetHash(next)}`;
      const changelog = prependEntry(
        current.changelog,
        buildEntry(dataVersion, report.date, report.changes),
      );
      archived = changelog.archived;
      report.dataVersion = dataVersion;
      files = renderDataset({
        dataVersion,
        generatedAt: isoSeconds(started),
        collections: next,
        changelog: changelog.kept,
        extraFiles,
      });
    }

    // 8. Schema, layout and integrity of exactly what would be written.
    const problems = validateDataset(files);
    if (problems.length > 0) {
      throw new RunFailure(
        "invalid-data",
        problems.map((p) => `${p.file}: ${p.path ? `${p.path}: ` : ""}${p.message}`),
      );
    }

    // 9 + 11. Stage and swap, then the files that depend on a successful publish.
    if (!unchanged) {
      await writeDataset(dataDir, files);
      await archiveEntries(dataDir, archived);
      report.changed = true;
    }
    if (idLock.serialize() !== lockBefore) {
      await writeIdLock(idLockPath(dataDir), idLock);
    }
    report.ok = true;
  } catch (error) {
    const failure = classify(error);
    report.failure = { kind: failure.kind, messages: [...failure.messages] };
    logger.error("scrape failed", { kind: failure.kind, messages: failure.messages });
  } finally {
    report.http = options.http?.stats ?? null;
    report.durationMs = options.now().getTime() - started.getTime();
  }
  return report;
}
