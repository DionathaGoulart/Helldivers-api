import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { newKeyId, signKey, verifyKey } from "../src/lib/keys.ts";

// Usage: pnpm key:issue [--id <12 of a-z0-9>] [--env-file <path>]   prints a new key (or re-derives
//                                                                   the key of an id)
//        pnpm key:check <key> [--env-file <path>]    says whether a key is valid under the secret
// The secret is API_KEY_SECRET from the environment, `--env-file` (production: the file that holds
// the production secret) or apps/api/.dev.vars (local). Keep who got which id somewhere private:
// the key itself carries only the id.
const { values, positionals } = parseArgs({
  options: { id: { type: "string" }, "env-file": { type: "string" } },
  allowPositionals: true,
});
if (values["env-file"] && !existsSync(values["env-file"])) {
  console.error(`keys: ${values["env-file"]} does not exist`);
  process.exit(1);
}
// Earlier files win: loadEnvFile never overrides a variable that is already set.
const devVars = join(import.meta.dirname, "..", ".dev.vars");
for (const file of [values["env-file"], devVars]) {
  if (file && existsSync(file)) process.loadEnvFile(file);
}
const secret = process.env.API_KEY_SECRET;
if (!secret) {
  console.error("keys: API_KEY_SECRET is not set (environment or apps/api/.dev.vars)");
  process.exit(1);
}

const [command, key] = positionals;
if (command === "issue") {
  console.log(await signKey(secret, values.id ?? newKeyId()));
} else if (command === "check" && key) {
  const check = await verifyKey(secret, key, new Set());
  console.log(check.ok ? `valid · id ${check.id}` : `invalid · the key ${check.reason}`);
  if (!check.ok) process.exitCode = 1;
} else {
  console.error("usage: pnpm key:issue [--id <id>] | pnpm key:check <key>");
  process.exitCode = 1;
}
