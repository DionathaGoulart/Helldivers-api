import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Change, Collection } from "@hd2/schemas";
import type { HttpStats } from "../http/client.ts";
import type { ImageStats } from "../images/attach.ts";

// `.reports/summary.md` (job summary) and `.reports/commit-message.txt` (arch §6.6).

export type FailureKind =
  | "robots-changed"
  | "blocked"
  | "parser-broken"
  | "empty"
  | "count-drop"
  | "index-coverage"
  | "invalid-data"
  | "images"
  | "error";

export interface RunReport {
  ok: boolean;
  changed: boolean; // data/v1 was rewritten
  date: string;
  mode: "online" | "offline";
  fullRefresh: boolean;
  dataVersion: string | null;
  counts: { collection: Collection; before: number; after: number }[];
  changes: Change[];
  warnings: string[];
  failure: { kind: FailureKind; messages: string[] } | null;
  http: HttpStats | null;
  images: ImageStats | null; // null when the run failed before step 7
  durationMs: number;
}

const TOP_CHANGES = 20;

function tally(changes: readonly Change[]) {
  const count = (kind: Change["kind"]) => changes.filter((change) => change.kind === kind).length;
  return `+${count("added")} ~${count("changed")} -${count("removed")}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function renderSummary(report: RunReport): string {
  const lines = [
    `## Scrape ${report.date} · ${report.ok ? "ok" : `failed (${report.failure?.kind})`}`,
    "",
  ];

  if (report.ok) {
    lines.push(
      report.changed
        ? `Changes ${tally(report.changes)} · data version \`${report.dataVersion}\``
        : `No changes · data version \`${report.dataVersion}\``,
      "",
    );
  } else {
    lines.push("Nothing was published; `data/v1` is untouched.", "", "### Failure", "");
    lines.push(...(report.failure?.messages ?? []).map((message) => `- ${message}`), "");
  }

  if (report.counts.length > 0) {
    lines.push("| Collection | Before | After | Changes |", "| --- | ---: | ---: | --- |");
    for (const { collection, before, after } of report.counts) {
      const changes = report.changes.filter((change) => change.collection === collection);
      lines.push(`| ${collection} | ${before} | ${after} | ${tally(changes)} |`);
    }
    lines.push("");
  }

  const http = report.http;
  const requests = http
    ? `Requests ${http.requests} · 304 ${http.notModified} (${http.requests ? Math.round((http.notModified / http.requests) * 100) : 0} %) · ${formatBytes(http.bytes)} · retries ${http.retries} · pauses ${http.pauses}`
    : "Offline run (fixtures)";
  lines.push(
    `${requests} · full refresh ${report.fullRefresh ? "yes" : "no"} · ${formatDuration(report.durationMs)}`,
    "",
  );
  const images = report.images;
  if (images) {
    lines.push(
      `Images fetched ${images.fetched} · uploaded ${images.uploaded} · reused ${images.reused} · failed ${images.failed} · orphans ${images.orphans} (deleted ${images.deleted}) · ${images.images} images, ${formatBytes(images.bytes)}`,
      "",
    );
  }

  if (report.changes.length > 0) {
    lines.push(
      `### Changes (${Math.min(TOP_CHANGES, report.changes.length)} of ${report.changes.length})`,
      "",
    );
    for (const change of report.changes.slice(0, TOP_CHANGES)) {
      const paths =
        change.kind === "changed" ? `: ${change.paths.map((p) => `\`${p}\``).join(", ")}` : "";
      lines.push(`- \`${change.collection}/${change.id}\` ${change.kind}${paths}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push(
      `### Warnings (${report.warnings.length})`,
      "",
      ...report.warnings.map((w) => `- ${w}`),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** `chore(data): update 2026-09-15 (+2 ~5 -0)` with one line per changed collection. */
export function renderCommitMessage(report: RunReport): string {
  const body = report.counts
    .map(({ collection }) => ({
      collection,
      changes: report.changes.filter((change) => change.collection === collection),
    }))
    .filter(({ changes }) => changes.length > 0)
    .map(({ collection, changes }) => `${collection}: ${tally(changes)}`);
  const subject = `chore(data): update ${report.date} (${tally(report.changes)})`;
  return `${[subject, ...(body.length > 0 ? ["", ...body] : [])].join("\n")}\n`;
}

/** Writes the summary always and the commit message only when data changed. */
export async function writeReports(dir: string, report: RunReport): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "summary.md"), renderSummary(report));
  const commitMessage = join(dir, "commit-message.txt");
  if (report.ok && report.changed) {
    await writeFile(commitMessage, renderCommitMessage(report));
  } else {
    await rm(commitMessage, { force: true });
  }
}
