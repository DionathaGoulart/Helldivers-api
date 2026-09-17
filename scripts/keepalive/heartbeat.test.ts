import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_FILE,
  HEARTBEAT_MESSAGE,
  type KeepaliveDeps,
  renderHeartbeat,
  runKeepalive,
} from "./heartbeat.ts";

const NOW = new Date("2026-11-01T18:07:03.412Z");

function deps(lastCommit: Date | null) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const api: KeepaliveDeps = {
    lastCommit: () => Promise.resolve(lastCommit),
    write: (file, contents) => {
      files.set(file, contents);
      return Promise.resolve();
    },
    commit: (file, message) => {
      calls.push(`commit:${file}:${message}`);
      return Promise.resolve();
    },
    now: () => NOW,
    log: (line) => calls.push(`log:${line}`),
  };
  return { api, calls, files };
}

describe("keepalive", () => {
  it("does nothing while the repository is active", async () => {
    const { api, calls } = deps(new Date("2026-10-20T10:00:00Z")); // 12 days
    expect(await runKeepalive({ maxIdleDays: 45, dryRun: false }, api)).toBe(false);
    expect(calls).toEqual(["log:keepalive: last commit 12.3 days ago, under 45; nothing to do"]);
  });

  it("commits the heartbeat once the repository is idle", async () => {
    const { api, calls, files } = deps(new Date("2026-09-01T18:07:00Z")); // 61 days
    expect(await runKeepalive({ maxIdleDays: 45, dryRun: false }, api)).toBe(true);
    expect(calls.at(-1)).toBe(`commit:${HEARTBEAT_FILE}:${HEARTBEAT_MESSAGE}`);
    expect(JSON.parse(files.get(HEARTBEAT_FILE) ?? "")).toEqual({
      checkedAt: "2026-11-01T18:07:03Z",
      note: "The wiki has not changed for 61 days; this commit keeps the scheduled scrape enabled.",
    });
  });

  it("writes nothing on a dry run and treats a repository without commits as idle", async () => {
    const { api, calls, files } = deps(null);
    expect(await runKeepalive({ maxIdleDays: 45, dryRun: true }, api)).toBe(false);
    expect(files.size).toBe(0);
    expect(calls.some((call) => call.includes("last commit unknown"))).toBe(true);
  });

  it("renders a heartbeat that only changes with the date", () => {
    expect(renderHeartbeat(NOW, 61)).toBe(renderHeartbeat(NOW, 61));
    expect(renderHeartbeat(NOW, 61)).not.toBe(renderHeartbeat(NOW, 62));
    expect(renderHeartbeat(NOW, 61).endsWith("\n")).toBe(true);
  });
});
