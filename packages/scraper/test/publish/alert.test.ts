import { describe, expect, it } from "vitest";
import {
  ALERT_LABEL,
  type Alert,
  type AlertRun,
  clearAlerts,
  deployAlert,
  type GitHubIssue,
  type IssueApi,
  RestIssueApi,
  raiseAlert,
  scrapeAlert,
} from "../../src/publish/alert.ts";
import type { RunReport } from "../../src/publish/report.ts";

const run: AlertRun = {
  url: "https://github.com/DionathaGoulart/Helldivers-api/actions/runs/42",
  sha: "1c7e5f9",
  workflow: "scrape",
};

const failed: RunReport = {
  ok: false,
  changed: false,
  date: "2026-09-17",
  mode: "online",
  fullRefresh: false,
  dataVersion: null,
  previousDataVersion: "2026-09-17.2d3c0c72",
  counts: [
    { collection: "weapons", before: 104, after: 80 },
    { collection: "boosters", before: 18, after: 18 },
  ],
  changes: [],
  conflicts: 0,
  warnings: ["weapons/ar-23-liberator: no description"],
  failure: {
    kind: "count-drop",
    collection: "weapons",
    messages: ["weapons: 104 → 80 (-23.1 %, limit 10.0 %); rerun with --allow-drop if the wiki…"],
  },
  http: { requests: 400, notModified: 390, bytes: 1_000, retries: 0, pauses: 4 },
  images: null,
  durationMs: 600_000,
};

class FakeApi implements IssueApi {
  readonly calls: string[] = [];
  #next = 7;

  constructor(private issues: GitHubIssue[] = []) {}

  open(label: string): Promise<GitHubIssue[]> {
    this.calls.push(`open:${label}`);
    return Promise.resolve([...this.issues]);
  }

  create(alert: Alert, label: string): Promise<GitHubIssue> {
    this.calls.push(`create:${alert.title}:${label}`);
    const issue = { number: this.#next++, title: alert.title };
    this.issues = [...this.issues, issue];
    return Promise.resolve(issue);
  }

  comment(issue: number, body: string): Promise<void> {
    this.calls.push(`comment:${issue}:${body.split("\n")[0]}`);
    return Promise.resolve();
  }

  close(issue: number, _body: string): Promise<void> {
    this.calls.push(`close:${issue}`);
    this.issues = this.issues.filter((open) => open.number !== issue);
    return Promise.resolve();
  }
}

describe("alert bodies", () => {
  it("names the kind, the collection, the run and the last good data", () => {
    const alert = scrapeAlert(failed, run);
    expect(alert.title).toBe("[scraper] count-drop: weapons");
    expect(alert.body).toContain("failed with `count-drop`; `data/v1` is untouched");
    expect(alert.body).toContain(`Run: ${run.url}`);
    expect(alert.body).toContain("Last good data version: `2026-09-17.2d3c0c72`");
    expect(alert.body).toContain("- weapons: 104 → 80"); // only the collections that moved
    expect(alert.body).not.toContain("boosters");
    expect(alert.body).toContain("- weapons/ar-23-liberator: no description");
  });

  it("titles a failure outside the pipelines after the run", () => {
    const failure = { kind: "robots-changed" as const, collection: null, messages: ["signal"] };
    expect(scrapeAlert({ ...failed, failure }, run).title).toBe("[scraper] robots-changed: run");
  });

  it("caps long lists", () => {
    const messages = Array.from({ length: 25 }, (_, i) => `problem ${i}`);
    const failure = { kind: "parser-broken" as const, collection: "weapons" as const, messages };
    const body = scrapeAlert({ ...failed, failure }, run).body;
    expect(body).toContain("- problem 19");
    expect(body).not.toContain("- problem 20");
    expect(body).toContain("- … 5 more");
  });

  it("builds the deploy alert", () => {
    const alert = deployAlert("smoke-failed", { ...run, workflow: "deploy" });
    expect(alert.title).toBe("[deploy] smoke-failed");
    expect(alert.body).toContain("previous Pages deployment stays live");
  });
});

describe("raise and clear", () => {
  it("opens one issue and comments on the next failure with the same title", async () => {
    const api = new FakeApi();
    expect(await raiseAlert(api, scrapeAlert(failed, run))).toBe(
      "opened #7 ([scraper] count-drop: weapons)",
    );
    expect(await raiseAlert(api, scrapeAlert(failed, run))).toBe(
      "commented on #7 ([scraper] count-drop: weapons)",
    );
    expect(api.calls).toEqual([
      `open:${ALERT_LABEL}`,
      `create:[scraper] count-drop: weapons:${ALERT_LABEL}`,
      `open:${ALERT_LABEL}`,
      "comment:7:The scrape run failed with `count-drop`; `data/v1` is untouched and nothing was deployed.",
    ]);
  });

  it("opens a second issue for a different kind", async () => {
    const api = new FakeApi([{ number: 3, title: "[scraper] blocked: weapons" }]);
    expect(await raiseAlert(api, scrapeAlert(failed, run))).toBe(
      "opened #7 ([scraper] count-drop: weapons)",
    );
  });

  it("closes the scrape alerts on a green run and leaves the deploy ones open", async () => {
    const api = new FakeApi([
      { number: 3, title: "[scraper] blocked: weapons" },
      { number: 4, title: "[deploy] smoke-failed" },
      { number: 5, title: "[scraper] count-drop: weapons" },
    ]);
    expect(await clearAlerts(api, run)).toBe("closed #3, #5");
    expect(api.calls).toEqual([`open:${ALERT_LABEL}`, "close:3", "close:5"]);
    expect(await clearAlerts(api, run)).toBe("no open alerts");
  });

  it("closes only the deploy alerts after a green deploy", async () => {
    const api = new FakeApi([
      { number: 3, title: "[scraper] blocked: weapons" },
      { number: 4, title: "[deploy] smoke-failed" },
    ]);
    expect(await clearAlerts(api, { ...run, workflow: "deploy" })).toBe("closed #4");
  });
});

describe("RestIssueApi", () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const api = new RestIssueApi({
    repo: "DionathaGoulart/Helldivers-api",
    token: "t0ken",
    fetch: (url, init) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      const ok = (value: unknown) => Promise.resolve(Response.json(value));
      if (url.endsWith("/labels")) return Promise.resolve(new Response("exists", { status: 422 }));
      if (url.includes("/issues?"))
        return ok([{ number: 9, title: "[scraper] blocked: run", x: 1 }]);
      return ok({ number: 9, title: "[scraper] blocked: run" });
    },
  });

  it("lists, creates and closes through the issues API", async () => {
    expect(await api.open(ALERT_LABEL)).toEqual([{ number: 9, title: "[scraper] blocked: run" }]);
    await api.create({ title: "[scraper] blocked: run", body: "b" }, ALERT_LABEL);
    await api.close(9, "fixed");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /repos/DionathaGoulart/Helldivers-api/issues",
      "POST /repos/DionathaGoulart/Helldivers-api/labels", // 422 when it already exists: ignored
      "POST /repos/DionathaGoulart/Helldivers-api/issues",
      "POST /repos/DionathaGoulart/Helldivers-api/issues/9/comments",
      "PATCH /repos/DionathaGoulart/Helldivers-api/issues/9",
    ]);
    expect(calls.at(2)?.body).toEqual({
      title: "[scraper] blocked: run",
      body: "b",
      labels: [ALERT_LABEL],
    });
    expect(calls.at(-1)?.body).toEqual({ state: "closed", state_reason: "completed" });
  });

  it("reports an API error with its status", async () => {
    const failing = new RestIssueApi({
      repo: "a/b",
      token: "t",
      fetch: () => Promise.resolve(new Response("bad credentials", { status: 401 })),
    });
    await expect(failing.open(ALERT_LABEL)).rejects.toThrow(/failed: 401 bad credentials/);
  });
});
