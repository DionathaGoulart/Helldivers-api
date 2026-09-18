import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { newKeyId, signKey, verifyKey } from "../src/lib/keys.ts";

// Usage: pnpm key:issue [--id <12 of a-z0-9>]   prints a new key (or re-derives the key of an id)
//        pnpm key:check <key>                   says whether a key is valid under the secret
// The secret is API_KEY_SECRET from the environment or apps/api/.dev.vars; for production keys,
// run with the production secret in the environment. Keep who got which id somewhere private:
// the key itself carries only the id.
const devVars = join(import.meta.dirname, "..", ".dev.vars");
if (existsSync(devVars)) process.loadEnvFile(devVars);
const secret = process.env.API_KEY_SECRET;
if (!secret) {
  console.error("keys: API_KEY_SECRET is not set (environment or apps/api/.dev.vars)");
  process.exit(1);
}

const { values, positionals } = parseArgs({
  options: { id: { type: "string" } },
  allowPositionals: true,
});
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
