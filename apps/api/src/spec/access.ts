// Access tiers of the dynamic routes (arch §8.6, ADR-012). Static files have no tier and no limit.
// Each tier is one rate limiting binding in wrangler.toml (checked by test/access.test.ts), the
// fallback when the `LIMITER` Durable Object cannot answer; the binding counts per Cloudflare
// location and is approximate by design (Workers docs).

export const TIERS = {
  /** No key, no allowlisted origin: a demo. Counted per IP (IPv6 per /64). */
  anon: { binding: "RL_ANON", limit: 10, period: 60 },
  /** Browser requests from an allowlisted origin or the docs site. Counted per origin and IP. */
  origin: { binding: "RL_ORIGIN", limit: 10, period: 10 },
  /** A key from `pnpm key:issue`, sent as `Authorization: Bearer hd2_…`. Counted per key. */
  key: { binding: "RL_KEY", limit: 20, period: 10 },
} as const satisfies Record<string, { binding: string; limit: number; period: 10 | 60 }>;

/**
 * `unlimited`: a key whose id is in `UNLIMITED_KEYS` (wrangler.toml [vars]), for the maintainer's
 * own apps. No per-client limit; the daily budget, the zone's WAF flood rule still apply.
 */
export type Tier = keyof typeof TIERS | "unlimited";

/**
 * Daily budget of the dynamic routes (arch §8.6, ADR-013). Workers Free runs the Worker 100,000
 * times a UTC day, then answers Cloudflare's own 429 until 00:00 UTC; every request that reaches
 * the Worker counts, a preflight, a 401 or a 429 included. The `LIMITER` counts them all.
 */
export const DAILY_BUDGET = {
  /** `anon`, `origin` and `key` get 503 `daily-budget-spent` from here; the rest is kept for `unlimited`. */
  shared: 80_000,
  /** Every tier gets 503 from here: 5,000 short of Cloudflare's limit, for what the count misses. */
  total: 95_000,
  /** Responses carry `X-API-Warning` once fewer are left under their tier's cap. */
  warnBelow: 15_000,
} as const;

/** The daily cap of a tier. */
export const dailyCap = (tier: Tier): number =>
  tier === "unlimited" ? DAILY_BUDGET.total : DAILY_BUDGET.shared;

/**
 * Hostnames whose pages get the `origin` tier, matched against the `Origin` header browsers send.
 * `*.example.com` also matches every subdomain. Add one per approved access request (link the
 * issue in the commit). A server can forge `Origin`, so this is a convenience, not a secret:
 * the forger still gets only its own IP's share.
 */
export const ALLOWED_ORIGINS: readonly string[] = [];
