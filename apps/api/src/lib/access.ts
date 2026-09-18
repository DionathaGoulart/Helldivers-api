import type { MiddlewareHandler } from "hono";
import type { AppContext, AppEnv, Env } from "../context.ts";
import { ACCESS_URL } from "../site.ts";
import { ALLOWED_ORIGINS, TIERS, type Tier } from "../spec/access.ts";
import { parseKeyIds, verifyKey } from "./keys.ts";
import { type ProblemInit, problemResponse } from "./problem.ts";

// Tier and rate limit of every dynamic request (arch §8.6, ADR-012): a key, else an allowlisted
// origin (or the docs site itself), else anonymous. Preflights are not counted.

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

export const policyHeader = (tier: keyof typeof TIERS) =>
  `"${tier}";q=${TIERS[tier].limit};w=${TIERS[tier].period}`;

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

export function accessControl(context: AppContext): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    const identified = await identify(c.req.raw, c.env, context.log);
    if (!identified.ok) {
      return problemResponse(c.req.url, identified.problem, {
        "WWW-Authenticate": 'Bearer realm="helldivers-api"',
      });
    }
    const { tier, bucket, label } = identified.client;
    if (tier === "unlimited") {
      await next();
      c.res = withHeaders(c.res, { "X-API-Tier": tier });
      return;
    }
    const { binding, limit, period } = TIERS[tier];
    const headers = { "X-API-Tier": tier, "RateLimit-Policy": policyHeader(tier) };

    const limiter = c.env[binding];
    let allowed = true;
    try {
      allowed = limiter ? (await limiter.limit({ key: bucket })).success : true;
    } catch (error) {
      // Fail open: the zone's WAF rule still stops floods before they reach the Worker.
      context.log(
        JSON.stringify({ level: "error", msg: "rate limiter failed", error: `${error}` }),
      );
    }
    if (!allowed) {
      const per = tier === "anon" ? " per IP" : "";
      return problemResponse(
        c.req.url,
        {
          type: "rate-limited",
          detail:
            `${label} may send ${limit} requests per ${period} s${per} to the dynamic routes. ` +
            `Retry after ${period} s, use the static files (no limit), or ask for more: ` +
            `${ACCESS_URL}.`,
        },
        { ...headers, "Retry-After": String(period) },
      );
    }
    await next();
    c.res = withHeaders(c.res, headers);
    return;
  };
}
