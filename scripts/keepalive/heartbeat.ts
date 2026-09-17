// GitHub disables a scheduled workflow after 60 days without repository activity (arch §7.3).
// A quiet wiki means no data commit, so `scrape.yml` runs this after every run with no changes:
// when the last commit is older than `--max-idle-days`, `status/heartbeat.json` is committed.

export const HEARTBEAT_FILE = "status/heartbeat.json";
export const HEARTBEAT_MESSAGE = "chore(status): keep the scheduled scrape alive";

export interface KeepaliveOptions {
  maxIdleDays: number;
  dryRun: boolean;
}

export interface KeepaliveDeps {
  /** Author date of the repository's last commit, `null` in a repository without commits. */
  lastCommit(): Promise<Date | null>;
  write(file: string, contents: string): Promise<void>;
  commit(file: string, message: string): Promise<void>;
  now(): Date;
  log(line: string): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function renderHeartbeat(now: Date, idleDays: number): string {
  return `${JSON.stringify(
    {
      checkedAt: `${now.toISOString().slice(0, 19)}Z`,
      note: `The wiki has not changed for ${idleDays} days; this commit keeps the scheduled scrape enabled.`,
    },
    null,
    2,
  )}\n`;
}

/** Returns true when a heartbeat was committed. */
export async function runKeepalive(
  options: KeepaliveOptions,
  deps: KeepaliveDeps,
): Promise<boolean> {
  const last = await deps.lastCommit();
  const now = deps.now();
  const idleDays =
    last === null ? Number.POSITIVE_INFINITY : (now.getTime() - last.getTime()) / DAY_MS;
  if (idleDays < options.maxIdleDays) {
    deps.log(
      `keepalive: last commit ${idleDays.toFixed(1)} days ago, under ${options.maxIdleDays}; nothing to do`,
    );
    return false;
  }
  const rounded = Number.isFinite(idleDays) ? Math.floor(idleDays) : 0;
  deps.log(
    `keepalive: last commit ${Number.isFinite(idleDays) ? `${rounded} days ago` : "unknown"}; writing ${HEARTBEAT_FILE}`,
  );
  if (options.dryRun) {
    deps.log(renderHeartbeat(now, rounded));
    return false;
  }
  await deps.write(HEARTBEAT_FILE, renderHeartbeat(now, rounded));
  await deps.commit(HEARTBEAT_FILE, HEARTBEAT_MESSAGE);
  return true;
}
