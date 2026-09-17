import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  clearAlerts,
  deployAlert,
  RestIssueApi,
  raiseAlert,
  scrapeAlert,
} from "../src/publish/alert.ts";
import { RUN_REPORT_FILE, type RunReport } from "../src/publish/report.ts";

// Usage: pnpm alert [--report .reports] [--deploy smoke-failed] [--dry-run]
// Reads `.reports/run.json`: a failed run opens or comments on its `scraper-alert` issue, a green
// one closes the open scrape alerts (arch §7.2). `--deploy <kind>` skips the report and opens
// `[deploy] <kind>`; `deploy.yml` runs it on failure. Needs GH_TOKEN and GITHUB_REPOSITORY.

const { values } = parseArgs({
  options: {
    report: { type: "string", default: ".reports" },
    deploy: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

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

const alert = values.deploy
  ? deployAlert(values.deploy, run)
  : await (async () => {
      const file = join(resolve(cwd, values.report), RUN_REPORT_FILE);
      const report = JSON.parse(await readFile(file, "utf8")) as RunReport;
      return report.ok ? null : scrapeAlert(report, run);
    })();

if (values["dry-run"]) {
  console.log(alert ? `${alert.title}\n\n${alert.body}` : "run ok: would close open alerts");
  process.exit(0);
}
if (!(repo && token)) {
  console.error("alert: GITHUB_REPOSITORY and GH_TOKEN are required outside --dry-run");
  process.exit(1);
}

const api = new RestIssueApi({ repo, token, fetch: (url, init) => fetch(url, init) });
console.log(alert ? await raiseAlert(api, alert) : await clearAlerts(api, run));
