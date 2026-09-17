import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { runKeepalive } from "./keepalive/heartbeat.ts";

// Usage: pnpm keepalive [--max-idle-days 45] [--dry-run]
// Run by `scrape.yml` after a run with no data changes. The commit is the bot's, like the data
// commits (plan §0.7), and is pushed so GitHub sees the repository as active.

const { values } = parseArgs({
  options: {
    "max-idle-days": { type: "string", default: "45" },
    "dry-run": { type: "boolean", default: false },
  },
});

const root = join(import.meta.dirname, "..");
const run = promisify(execFile);
const git = async (args: string[]) => (await run("git", args, { cwd: root })).stdout.trim();

const BOT = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=41898282+github-actions[bot]@users.noreply.github.com",
];

const committed = await runKeepalive(
  { maxIdleDays: Number(values["max-idle-days"]), dryRun: values["dry-run"] },
  {
    lastCommit: async () => {
      const iso = await git(["log", "-1", "--format=%cI"]).catch(() => "");
      return iso ? new Date(iso) : null;
    },
    write: async (file, contents) => {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    },
    commit: async (file, message) => {
      await git(["add", file]);
      await git([...BOT, "commit", "-m", message]);
      await git(["pull", "--rebase"]);
      await git(["push"]);
    },
    now: () => new Date(),
    log: (line) => console.log(line),
  },
);
if (committed) {
  console.log("keepalive: heartbeat committed and pushed");
}
