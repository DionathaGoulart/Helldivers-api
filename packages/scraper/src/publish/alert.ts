import type { RunReport } from "./report.ts";

// arch §7.2: a failed run opens (or comments on) one `scraper-alert` issue; the next green run
// closes the open ones. `deploy.yml` reports its own smoke failure through the same path. A green
// run that worked around the wiki contradicting itself keeps one `[wiki]` issue up to date
// instead: the data published, but a wiki edit is due.

export const ALERT_LABEL = "scraper-alert";
const MAX_MESSAGES = 20;

export interface AlertRun {
  /** `https://github.com/<owner>/<repo>/actions/runs/<id>`, or null outside Actions. */
  url: string | null;
  sha: string | null;
  workflow: string; // "scrape" or "deploy"
}

export interface Alert {
  title: string;
  body: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
}

/** The slice of the GitHub issues API the alert needs (`GH_TOKEN`, `issues: write`). */
export interface IssueApi {
  open(label: string): Promise<GitHubIssue[]>;
  create(alert: Alert, label: string): Promise<GitHubIssue>;
  comment(issue: number, body: string): Promise<void>;
  update(issue: number, body: string): Promise<void>;
  close(issue: number, body: string): Promise<void>;
}

function lines(run: AlertRun): string[] {
  return [...(run.url ? [`Run: ${run.url}`] : []), ...(run.sha ? [`Commit: \`${run.sha}\``] : [])];
}

function list(items: readonly string[]): string[] {
  const shown = items.slice(0, MAX_MESSAGES).map((item) => `- ${item}`);
  return items.length > MAX_MESSAGES
    ? [...shown, `- … ${items.length - MAX_MESSAGES} more`]
    : shown;
}

/** `[scraper] count-drop: weapons` with the failing checks, the counts and the last good data. */
export function scrapeAlert(report: RunReport, run: AlertRun): Alert {
  const failure = report.failure ?? { kind: "error" as const, collection: null, messages: [] };
  const counts = report.counts
    .filter(({ before, after }) => before !== after)
    .map(({ collection, before, after }) => `${collection}: ${before} → ${after}`);
  const body = [
    `The ${run.workflow} run failed with \`${failure.kind}\`; \`data/v1\` is untouched and nothing was deployed.`,
    "",
    ...lines(run),
    `Last good data version: ${report.previousDataVersion ? `\`${report.previousDataVersion}\`` : "none"}`,
    "",
    "### Failing checks",
    "",
    ...list(failure.messages),
    ...(counts.length > 0 ? ["", "### Counts", "", ...list(counts)] : []),
    ...(report.warnings.length > 0
      ? ["", `### Warnings (${report.warnings.length})`, "", ...list(report.warnings)]
      : []),
  ];
  return {
    title: `[scraper] ${failure.kind}: ${failure.collection ?? "run"}`,
    body: `${body.join("\n").trimEnd()}\n`,
  };
}

/** `[deploy] smoke-failed`, opened by `deploy.yml` when the deployed site fails its checks. */
export function deployAlert(kind: string, run: AlertRun): Alert {
  const body = [
    `The deploy workflow failed at \`${kind}\`. The previous deployment stays live.`,
    "",
    ...lines(run),
  ];
  return { title: `[deploy] ${kind}`, body: `${body.join("\n").trimEnd()}\n` };
}

export const WIKI_ALERT_TITLE = "[wiki] contradictions to fix";

/** The `[wiki]` issue of a green run, or null when the wiki no longer contradicts itself. */
export function wikiAlert(report: RunReport, run: AlertRun): Alert | null {
  const fixes = report.wikiFixes ?? [];
  if (!report.ok || fixes.length === 0) {
    return null;
  }
  const body = [
    "The wiki contradicts itself below. The run published anyway: a page conflict took the page two of three accounts give (rule 12), a quarantined entity kept its published version or waits when new. Fixing the wiki page clears each line on the next run.",
    "",
    ...lines(run),
    `Data version: ${report.dataVersion ? `\`${report.dataVersion}\`` : "none"}`,
    "",
    `### Contradictions (${fixes.length})`,
    "",
    ...list(fixes),
  ];
  return { title: WIKI_ALERT_TITLE, body: `${body.join("\n").trimEnd()}\n` };
}

/**
 * Keeps the one `[wiki]` issue in step with the latest green run: opened, its body replaced
 * (a daily comment with the same list would be noise), or closed once the list is empty.
 */
export async function syncWikiAlert(
  api: IssueApi,
  alert: Alert | null,
  run: AlertRun,
): Promise<string> {
  const existing = (await api.open(ALERT_LABEL)).find((issue) => issue.title === WIKI_ALERT_TITLE);
  if (alert && existing) {
    await api.update(existing.number, alert.body);
    return `updated #${existing.number} (${alert.title})`;
  }
  if (alert) {
    const created = await api.create(alert, ALERT_LABEL);
    return `opened #${created.number} (${alert.title})`;
  }
  if (existing) {
    const body = ["The wiki no longer contradicts itself; closing.", "", ...lines(run)];
    await api.close(existing.number, `${body.join("\n").trimEnd()}\n`);
    return `closed #${existing.number} (${WIKI_ALERT_TITLE})`;
  }
  return "no wiki contradictions";
}

/** Opens the alert, or comments on the open issue with the same title (never a duplicate). */
export async function raiseAlert(api: IssueApi, alert: Alert): Promise<string> {
  const existing = (await api.open(ALERT_LABEL)).find((issue) => issue.title === alert.title);
  if (existing) {
    await api.comment(existing.number, alert.body);
    return `commented on #${existing.number} (${alert.title})`;
  }
  const created = await api.create(alert, ALERT_LABEL);
  return `opened #${created.number} (${alert.title})`;
}

/**
 * A green run closes the scrape alerts it could have opened. Deploy alerts stay open: only a
 * green deploy clears those.
 */
export async function clearAlerts(api: IssueApi, run: AlertRun): Promise<string> {
  const prefix = run.workflow === "deploy" ? "[deploy] " : "[scraper] ";
  const open = (await api.open(ALERT_LABEL)).filter((issue) => issue.title.startsWith(prefix));
  for (const issue of open) {
    await api.close(
      issue.number,
      `${["The next green run fixed this; closing.", "", ...lines(run)].join("\n").trimEnd()}\n`,
    );
  }
  return open.length === 0
    ? "no open alerts"
    : `closed ${open.map((issue) => `#${issue.number}`).join(", ")}`;
}

/** GitHub REST over `fetch`: `gh` is not installed on every machine that runs a scrape. */
export class RestIssueApi implements IssueApi {
  constructor(
    private readonly options: {
      repo: string; // "owner/name"
      token: string;
      apiUrl?: string;
      fetch: (url: string, init: RequestInit) => Promise<Response>;
    },
  ) {}

  async #send(path: string, init: RequestInit = {}): Promise<unknown> {
    const base = this.options.apiUrl ?? "https://api.github.com";
    const response = await this.options.fetch(`${base}/repos/${this.options.repo}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.options.token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub ${init.method ?? "GET"} ${path} failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }
    return response.json();
  }

  async open(label: string): Promise<GitHubIssue[]> {
    const issues = (await this.#send(
      `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
    )) as GitHubIssue[];
    return issues.map(({ number, title }) => ({ number, title }));
  }

  async create(alert: Alert, label: string): Promise<GitHubIssue> {
    // The label is created on the first alert; a repeat call answers 422, which is fine.
    await this.#send("/labels", {
      method: "POST",
      body: JSON.stringify({
        name: label,
        color: "b60205",
        description: "Scraper or deploy alert",
      }),
    }).catch(() => undefined);
    const issue = (await this.#send("/issues", {
      method: "POST",
      body: JSON.stringify({ title: alert.title, body: alert.body, labels: [label] }),
    })) as GitHubIssue;
    return { number: issue.number, title: issue.title };
  }

  async comment(issue: number, body: string): Promise<void> {
    await this.#send(`/issues/${issue}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async update(issue: number, body: string): Promise<void> {
    await this.#send(`/issues/${issue}`, { method: "PATCH", body: JSON.stringify({ body }) });
  }

  async close(issue: number, body: string): Promise<void> {
    await this.comment(issue, body);
    await this.#send(`/issues/${issue}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
  }
}
