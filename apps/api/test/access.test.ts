import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedHost, ipBucket, policyHeader } from "../src/lib/access.ts";
import { newKeyId, parseKeyIds, signKey, verifyKey } from "../src/lib/keys.ts";
import { ACCESS_URL } from "../src/site.ts";
import { TIERS } from "../src/spec/access.ts";
import { FakeRateLimiter, harness, readBody } from "./helpers.ts";

const SECRET = "test-secret-with-enough-entropy";
const PATH = "/v1/query/boosters";
const IP = { "CF-Connecting-IP": "203.0.113.7" };

describe("ipBucket", () => {
  it("keeps IPv4 and counts IPv6 per /64", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:0:1:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:0:1::/64");
    expect(ipBucket("2001:DB8:0000:0001::1")).toBe("2001:db8:0:1::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("::ffff:198.51.100.2")).toBe("198.51.100.2");
  });
});

describe("allowedHost", () => {
  const list = ["example.com", "*.bots.example.org"];
  it("matches exact hosts and wildcard subdomains", () => {
    expect(allowedHost("https://example.com", list)).toBe("example.com");
    expect(allowedHost("http://example.com:8080", list)).toBe("example.com");
    expect(allowedHost("https://a.bots.example.org", list)).toBe("a.bots.example.org");
  });
  it("refuses everything else", () => {
    expect(allowedHost("https://www.example.com", list)).toBeNull();
    expect(allowedHost("https://bots.example.org", list)).toBeNull();
    expect(allowedHost("https://example.com.evil.net", list)).toBeNull();
    expect(allowedHost("null", list)).toBeNull();
    expect(allowedHost("chrome-extension://example.com", list)).toBeNull();
  });
});

describe("API keys", () => {
  it("round-trips, and rejects a tampered, foreign, revoked or malformed key", async () => {
    const id = newKeyId();
    expect(id).toMatch(/^[a-z0-9]{12}$/);
    const key = await signKey(SECRET, id);
    expect(key).toMatch(/^hd2_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(await verifyKey(SECRET, key, new Set())).toEqual({ ok: true, id });

    const at = key.length - 10;
    const flipped = key.slice(0, at) + (key[at] === "A" ? "B" : "A") + key.slice(at + 1);
    expect(await verifyKey(SECRET, flipped, new Set())).toEqual({
      ok: false,
      reason: "has an invalid signature",
    });
    // Same 256 bits, other spelling of the last character's 2 spare bits.
    const last = key.at(-1) ?? "";
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const twin = key.slice(0, -1) + alphabet.charAt(alphabet.indexOf(last) ^ 1);
    expect(await verifyKey(SECRET, twin, new Set())).toEqual({
      ok: false,
      reason: "is not an hd2_ key",
    });
    expect((await verifyKey("another-secret", key, new Set())).ok).toBe(false);
    expect(await verifyKey(SECRET, key, parseKeyIds(` x , ${id},`))).toEqual({
      ok: false,
      reason: "was revoked",
    });
    expect(await verifyKey(SECRET, "sk_live_123", new Set())).toEqual({
      ok: false,
      reason: "is not an hd2_ key",
    });
    await expect(signKey(SECRET, "UPPER")).rejects.toThrow("12 of [a-z0-9]");
  });
});

describe("wrangler.toml", () => {
  it("declares one rate limiting binding per tier, with the same limits", () => {
    const toml = readFileSync(join(import.meta.dirname, "../wrangler.toml"), "utf8");
    const bindings = [
      ...toml.matchAll(
        /name = "(\w+)"\nnamespace_id = "\d+"\nsimple = \{ limit = (\d+), period = (\d+) \}/g,
      ),
    ].map(([, binding, limit, period]) => ({
      binding,
      limit: Number(limit),
      period: Number(period),
    }));
    expect(bindings).toEqual(Object.values(TIERS));
  });
});

describe("access control", () => {
  const limiters = () => ({
    RL_ANON: new FakeRateLimiter(TIERS.anon.limit),
    RL_ORIGIN: new FakeRateLimiter(TIERS.origin.limit),
    RL_KEY: new FakeRateLimiter(TIERS.key.limit),
  });

  it("counts anonymous requests per IP and answers 429 past the limit", async () => {
    const env = limiters();
    const h = await harness({}, env);
    for (let i = 0; i < TIERS.anon.limit; i++) {
      const response = await h.get(PATH, IP);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-api-tier")).toBe("anon");
      expect(response.headers.get("ratelimit-policy")).toBe('"anon";q=10;w=60');
    }
    const limited = await h.get(PATH, IP);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.headers.get("x-api-tier")).toBe("anon");
    expect(limited.headers.get("access-control-expose-headers")).toContain("Retry-After");
    const body = await readBody(limited);
    expect(body.type).toMatch(/#rate-limited$/);
    expect(body.detail).toBe(
      "Anonymous clients may send 10 requests per 60 s per IP to the dynamic routes. Retry " +
        `after 60 s, use the static files (no limit), or ask for more: ${ACCESS_URL}.`,
    );
    // Another IP has its own budget.
    expect((await h.get(PATH, { "CF-Connecting-IP": "203.0.113.8" })).status).toBe(200);
    expect(env.RL_ANON.keys.at(-1)).toBe("anon:203.0.113.8");
  });

  it("gives the docs site and allowlisted origins the origin tier, per visitor", async () => {
    const env = limiters();
    const h = await harness({}, env);
    const own = await h.get(PATH, { ...IP, Origin: "https://helldivers-api.dionatha.com.br" });
    expect(own.headers.get("x-api-tier")).toBe("origin");
    expect(own.headers.get("ratelimit-policy")).toBe(policyHeader("origin"));
    const sameOrigin = await h.get(PATH, { ...IP, "Sec-Fetch-Site": "same-origin" });
    expect(sameOrigin.headers.get("x-api-tier")).toBe("origin");
    expect(env.RL_ORIGIN.keys).toEqual([
      "origin:helldivers-api.dionatha.com.br:203.0.113.7",
      "origin:helldivers-api.dionatha.com.br:203.0.113.7",
    ]);
    const other = await h.get(PATH, { ...IP, Origin: "https://someone-else.example" });
    expect(other.headers.get("x-api-tier")).toBe("anon");
  });

  it("counts a valid key per key and refuses a bad one with 401", async () => {
    const env = { ...limiters(), API_KEY_SECRET: SECRET, REVOKED_KEYS: "revokedid000" };
    const h = await harness({}, env);
    const key = await signKey(SECRET, "abcdefabcdef");
    const ok = await h.get(PATH, { ...IP, Authorization: `Bearer ${key}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-api-tier")).toBe("key");
    expect(env.RL_KEY.keys).toEqual(["key:abcdefabcdef"]);

    const revoked = await signKey(SECRET, "revokedid000");
    // The id of one key with the signature of another.
    const stolen = `hd2_abcdefabcdef_${revoked.slice(-43)}`;
    for (const [authorization, reason] of [
      [`Bearer ${revoked}`, "was revoked"],
      [`Bearer ${stolen}`, "has an invalid signature"],
      [`Basic ${key}`, "is not a Bearer token"],
    ]) {
      const response = await h.get(PATH, { ...IP, Authorization: authorization ?? "" });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="helldivers-api"');
      expect((await readBody(response)).detail).toContain(`The key in Authorization ${reason}.`);
    }
    expect(env.RL_ANON.keys).toEqual([]); // a refused key is not counted as anything
  });

  it("never counts a key listed in UNLIMITED_KEYS", async () => {
    const env = { ...limiters(), API_KEY_SECRET: SECRET, UNLIMITED_KEYS: "ownerid00000" };
    const h = await harness({}, env);
    const key = await signKey(SECRET, "ownerid00000");
    for (let i = 0; i < TIERS.key.limit + 5; i++) {
      const response = await h.get(PATH, { ...IP, Authorization: `Bearer ${key}` });
      expect(response.status).toBe(200);
      expect(response.headers.get("x-api-tier")).toBe("unlimited");
      expect(response.headers.has("ratelimit-policy")).toBe(false);
    }
    expect([...env.RL_KEY.keys, ...env.RL_ANON.keys]).toEqual([]);
  });

  it("treats a key as anonymous when the deployment has no secret, and says so in the log", async () => {
    const env = limiters();
    const h = await harness({}, env);
    const response = await h.get(PATH, { ...IP, Authorization: "Bearer hd2_whatever" });
    expect(response.headers.get("x-api-tier")).toBe("anon");
    expect(h.logs.join("\n")).toContain("API_KEY_SECRET is not set");
  });

  it("fails open when the limiter throws, and does not count preflights", async () => {
    const env = {
      RL_ANON: {
        limit: async () => {
          throw new Error("binding down");
        },
      },
    };
    const h = await harness({}, env);
    expect((await h.get(PATH, IP)).status).toBe(200);
    expect(h.logs.join("\n")).toContain("rate limiter failed");

    const counted = limiters();
    const h2 = await harness({}, counted);
    const preflight = await h2.get(
      PATH,
      { ...IP, "Access-Control-Request-Headers": "authorization" },
      "OPTIONS",
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(counted.RL_ANON.keys).toEqual([]);
  });

  it("stamps the tier of the current client on a cached response", async () => {
    const env = { ...limiters(), API_KEY_SECRET: SECRET };
    const h = await harness({}, env);
    const key = await signKey(SECRET, "abcdefabcdef");
    await h.get(PATH, { ...IP, Authorization: `Bearer ${key}` });
    await h.ctx.settle();
    expect(h.cache.puts).toHaveLength(1);
    const hit = await h.get(PATH, IP);
    expect(hit.headers.get("x-api-tier")).toBe("anon");
    expect(h.cache.puts).toHaveLength(1);
  });
});
