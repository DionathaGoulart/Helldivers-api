// Access tiers of the dynamic routes (arch §8.6, ADR-008). Static files have no tier and no limit.
// Each tier is one rate limiting binding in wrangler.toml (checked by test/access.test.ts); the
// limits are counted per Cloudflare location and are approximate by design (Workers docs).

export const TIERS = {
  /** No key, no allowlisted origin: a demo. Counted per IP (IPv6 per /64). */
  anon: { binding: "RL_ANON", limit: 10, period: 60 },
  /** Browser requests from an allowlisted origin or the docs site. Counted per origin and IP. */
  origin: { binding: "RL_ORIGIN", limit: 10, period: 10 },
  /** A key from `pnpm key:issue`, sent as `Authorization: Bearer hd2_…`. Counted per key. */
  key: { binding: "RL_KEY", limit: 20, period: 10 },
} as const satisfies Record<string, { binding: string; limit: number; period: 10 | 60 }>;

export type Tier = keyof typeof TIERS;

/**
 * Hostnames whose pages get the `origin` tier, matched against the `Origin` header browsers send.
 * `*.example.com` also matches every subdomain. Add one per approved access request (link the
 * issue in the commit). A server can forge `Origin`, so this is a convenience, not a secret:
 * the forger still gets only its own IP's share.
 */
export const ALLOWED_ORIGINS: readonly string[] = [];
