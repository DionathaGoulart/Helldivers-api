import type { Context, MiddlewareHandler } from "hono";
import type { AppContext, AppEnv, Env } from "../context.ts";
import { ACCESS_URL } from "../site.ts";
import { ALLOWED_ORIGINS, DAILY_BUDGET, dailyCap, TIERS, type Tier } from "../spec/access.ts";
import { ask, type Hit, type Verdict } from "./counter.ts";
import { parseKeyIds, verifyKey } from "./keys.ts";
import { type ProblemInit, problemResponse } from "./problem.ts";

// Tier, rate limit and daily budget of every dynamic request (arch §8.6, ADR-012, ADR-013): a key,
// else an allowlisted origin (or the docs site itself), else anonymous. The `LIMITER` Durable
// Object counts every request that reaches the Worker, exactly (counter.ts); when it cannot
// answer, the tier's rate limiting binding stands in and the budget goes unchecked (fail open).

/** Rate limiting binding (`[[ratelimits]]` in wrangler.toml). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Client {
  tier: Tier;
  /** What the binding counts: `anon:<ip>`, `origin:<host>:<ip>` or `key:<id>`. */
  bucket: string;
  /** Names the client in a 429 detail. */
  label: string;
}

/** IPv4 as is; IPv6 by its /64, since one subscriber usually gets a whole /64. */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return mapped;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** The hostname of `origin` when it is allowlisted (`*.example.com` covers subdomains). */
export function allowedHost(
  origin: string,
  allowed: readonly string[] = ALLOWED_ORIGINS,
): string | null {
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    host = url.hostname;
  } catch {
    return null;
  }
  const ok = allowed.some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry,
  );
  return ok ? host : null;
}

/** `RateLimit-Policy`: the tier's window, then its daily cap (`w` = a day, reset 00:00 UTC). */
export const policyHeader = (tier: Tier) =>
  [
    ...(tier === "unlimited" ? [] : [`"${tier}";q=${TIERS[tier].limit};w=${TIERS[tier].period}`]),
    `"daily";q=${dailyCap(tier)};w=86400`,
  ].join(", ");

const budgetOf = (tier: Tier) =>
  tier === "unlimited" ? "every client" : "anon, origin and key clients";

/** `X-API-Warning`, once fewer than `DAILY_BUDGET.warnBelow` requests are left under the cap. */
function budgetWarning(tier: Tier, budget: Hit): string | null {
  if (budget.remaining >= DAILY_BUDGET.warnBelow) return null;
  const cap = dailyCap(tier);
  const shared = DAILY_BUDGET.shared;
  const already = tier === "unlimited" && cap - budget.remaining > shared;
  return (
    (already ? `Anon, origin and key clients get 503 since ${shared} requests today. ` : "") +
    `${budget.remaining} of today's ${cap} query and search requests left for ${budgetOf(tier)}; ` +
    `then 503 daily-budget-spent until 00:00 UTC (in ${budget.reset} s).`
  );
}

type Identified = { ok: true; client: Client } | { ok: false; problem: ProblemInit };

export async function identify(
  request: Request,
  env: Env,
  log: (line: string) => void,
): Promise<Identified> {
  const headers = request.headers;
  const ip = ipBucket(headers.get("CF-Connecting-IP") ?? "unknown");

  const authorization = headers.get("Authorization");
  if (authorization !== null) {
    const invalid = (reason: string): Identified => ({
      ok: false,
      problem: {
        type: "invalid-key",
        detail:
          `The key in Authorization ${reason}. Check it, or send no Authorization header to use ` +
          `the anonymous limits (${ACCESS_URL}).`,
      },
    });
    const token = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
    if (!token) return invalid("is not a Bearer token");
    if (env.API_KEY_SECRET) {
      const check = await verifyKey(env.API_KEY_SECRET, token, parseKeyIds(env.REVOKED_KEYS));
      if (!check.ok) return invalid(check.reason);
      const tier = parseKeyIds(env.UNLIMITED_KEYS).has(check.id) ? "unlimited" : "key";
      return {
        ok: true,
        client: { tier, bucket: `key:${check.id}`, label: `Key ${check.id}` },
      } satisfies Identified;
    }
    // A deployment without the secret cannot tell a good key from a bad one: anonymous limits.
    log(JSON.stringify({ level: "error", msg: "API_KEY_SECRET is not set; key sent as anon" }));
  }

  const self = new URL(request.url).hostname;
  const origin = headers.get("Origin");
  const host =
    origin !== null
      ? allowedHost(origin, [...ALLOWED_ORIGINS, self])
      : headers.get("Sec-Fetch-Site") === "same-origin"
        ? self
        : null;
  if (host !== null) {
    return {
      ok: true,
      client: { tier: "origin", bucket: `origin:${host}:${ip}`, label: `Each visitor of ${host}` },
    } satisfies Identified;
  }
  return {
    ok: true,
    client: { tier: "anon", bucket: `anon:${ip}`, label: "Anonymous clients" },
  } satisfies Identified;
}

/** Adds headers to a response that may be immutable (a Cache API hit). */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
}

/** A request never refused on budget (a preflight, a refused method, a bad key): counted later. */
function countLater(c: Context<AppEnv>, context: AppContext): void {
  const counter = c.env.LIMITER;
  if (!counter) return;
  c.executionCtx.waitUntil(
    ask(counter, {}).catch((error) =>
      context.log(JSON.stringify({ level: "error", msg: "counter failed", error: `${error}` })),
    ),
  );
}

export function accessControl(context: AppContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      countLater(c, context);
      await next();
      return;
    }
    const identified = await identify(c.req.raw, c.env, context.log);
    if (!identified.ok) {
      countLater(c, context);
      return problemResponse(c.req.url, identified.problem, {
        "WWW-Authenticate": 'Bearer realm="helldivers-api"',
      });
    }
    const { tier, bucket, label } = identified.client;
    const cap = dailyCap(tier);
    const window = tier === "unlimited" ? null : TIERS[tier];
    const headers: Record<string, string> = {
      "X-API-Tier": tier,
      "RateLimit-Policy": policyHeader(tier),
    };

    let verdict: Verdict | null = null;
    if (c.env.LIMITER) {
      try {
        verdict = await ask(c.env.LIMITER, {
          cap,
          ...(window && { bucket, limit: window.limit, period: window.period }),
        });
      } catch (error) {
        context.log(JSON.stringify({ level: "error", msg: "counter failed", error: `${error}` }));
      }
    }
    if (verdict === null && window) {
      try {
        const limiter = c.env[window.binding];
        const allowed = limiter ? (await limiter.limit({ key: bucket })).success : true;
        const refused = { allowed, remaining: 0, reset: window.period };
        verdict = { budget: null, window: allowed ? null : refused };
      } catch (error) {
        // Fail open: the zone's WAF rule still stops floods before they reach the Worker.
        context.log(
          JSON.stringify({ level: "error", msg: "rate limiter failed", error: `${error}` }),
        );
      }
    }
    const budget = verdict?.budget ?? null;
    const counted = verdict?.window ?? null;
    headers.RateLimit = [
      ...(window && counted ? [`"${tier}";r=${counted.remaining};t=${counted.reset}`] : []),
      ...(budget ? [`"daily";r=${budget.remaining};t=${budget.reset}`] : []),
    ].join(", ");
    if (!headers.RateLimit) delete headers.RateLimit;

    if (budget && !budget.allowed) {
      return problemResponse(
        c.req.url,
        {
          type: "daily-budget-spent",
          detail:
            `Query and search have spent today's ${cap} requests for ${budgetOf(tier)}. They ` +
            `start over at 00:00 UTC, in ${budget.reset} s. The static files keep working (no ` +
            `limit): ${ACCESS_URL}.`,
        },
        { ...headers, "Retry-After": String(budget.reset) },
      );
    }
    if (window && counted && !counted.allowed) {
      const per = tier === "anon" ? " per IP" : "";
      return problemResponse(
        c.req.url,
        {
          type: "rate-limited",
          detail:
            `${label} may send ${window.limit} requests per ${window.period} s${per} to the ` +
            `dynamic routes. Retry after ${counted.reset} s, use the static files (no limit), or ` +
            `ask for more: ${ACCESS_URL}.`,
        },
        { ...headers, "Retry-After": String(counted.reset) },
      );
    }
    const warning = budget && budgetWarning(tier, budget);
    if (warning) headers["X-API-Warning"] = warning;
    await next();
    c.res = withHeaders(c.res, headers);
    return;
  };
}
