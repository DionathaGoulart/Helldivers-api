import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  clearAlerts,
  deployAlert,
  RestIssueApi,
  raiseAlert,
  scrapeAlert,
  syncWikiAlert,
  wikiAlert,
} from "../src/publish/alert.ts";
import { RUN_REPORT_FILE, type RunReport } from "../src/publish/report.ts";

// Usage: pnpm alert [--report .reports] [--deploy [--failed smoke-failed]] [--dry-run]
// Reads `.reports/run.json`: a failed run opens or comments on its `scraper-alert` issue, a green
// one closes the open scrape alerts and opens, updates or closes the `[wiki]` one (arch §7.2). `--deploy` works on the `[deploy] …` alerts
// instead: with `--failed <kind>` it opens one, without it closes them after a green deploy.
// Needs GH_TOKEN and GITHUB_REPOSITORY.

const { values } = parseArgs({
  options: {
    report: { type: "string", default: ".reports" },
    deploy: { type: "boolean", default: false },
    failed: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const EMPTY_REPORT: RunReport = {
  ok: false,
  changed: false,
  date: new Date().toISOString().slice(0, 10),
  mode: "online",
  fullRefresh: false,
  dataVersion: null,
  previousDataVersion: null,
  counts: [],
  changes: [],
  conflicts: 0,
  warnings: [],
  quarantined: [],
  wikiFixes: [],
  failure: null,
  http: null,
  images: null,
  durationMs: 0,
};

const cwd = process.env.INIT_CWD ?? process.cwd();
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const run = {
  url:
    process.env.GITHUB_SERVER_URL && repo && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
  sha: process.env.GITHUB_SHA ?? null,
  workflow: values.deploy ? "deploy" : "scrape",
};

// The scrape report; the job can fail before the scraper writes it (install, cache, validate:data).
const report = values.deploy
  ? null
  : await readFile(join(resolve(cwd, values.report), RUN_REPORT_FILE), "utf8").then(
      (text) => JSON.parse(text) as RunReport,
      (): RunReport => ({
        ...EMPTY_REPORT,
        failure: {
          kind: "error",
          collection: null,
          messages: [`the run failed before writing \`${values.report}/${RUN_REPORT_FILE}\``],
        },
      }),
    );
const alert = report
  ? report.ok
    ? null
    : scrapeAlert(report, run)
  : values.failed
    ? deployAlert(values.failed, run)
    : null;
// Green scrapes only; `undefined` leaves the [wiki] issue alone.
const wiki = report?.ok ? wikiAlert(report, run) : undefined;

if (values["dry-run"]) {
  console.log(
    alert
      ? `${alert.title}\n\n${alert.body}`
      : `run ok: would close open alerts${wiki ? `\n\n${wiki.title}\n\n${wiki.body}` : ""}`,
  );
  process.exit(0);
}
if (!(repo && token)) {
  console.error("alert: GITHUB_REPOSITORY and GH_TOKEN are required outside --dry-run");
  process.exit(1);
}

const api = new RestIssueApi({ repo, token, fetch: (url, init) => fetch(url, init) });
if (alert) {
  console.log(await raiseAlert(api, alert));
} else {
  console.log(await clearAlerts(api, run));
  if (wiki !== undefined) {
    console.log(await syncWikiAlert(api, wiki, run));
  }
}
