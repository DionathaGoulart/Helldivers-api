import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockedError } from "../../src/http/block-detect.ts";
import { HttpCache } from "../../src/http/cache.ts";
import { DisallowedUrlError, HttpClient, HttpError } from "../../src/http/client.ts";
import { parseRobots } from "../../src/http/robots.ts";
import type { Logger } from "../../src/log.ts";
import { OnlineSource } from "../../src/source.ts";
import { fakeClock } from "./fake-clock.ts";

const BASE = "https://helldivers.wiki.gg";
const UA = "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)";
const PAGE = '<html><body><div id="mw-content-text">Boosters</div></body></html>';
const pacing = { delayMs: 3_000, jitterMs: 0, pauseEvery: 100, pauseMs: 60_000 };

type Reply = Response | Error | ((request: Request) => Response);

function fakeFetch(replies: Reply[]) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`unexpected request ${request.url}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(request) : reply;
  };
  return { fetch, requests };
}

const html = (body = PAGE, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html", ...headers } });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hd2-http-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function client(
  replies: Reply[],
  overrides: {
    fullRefresh?: boolean;
    cache?: boolean;
    logger?: Logger;
    requestTimeoutMs?: number;
  } = {},
) {
  const clock = fakeClock();
  const { fetch, requests } = fakeFetch(replies);
  const http = new HttpClient({
    baseUrl: BASE,
    userAgent: UA,
    pacing: { ...pacing },
    cache: overrides.cache === false ? null : new HttpCache(join(dir, "http")),
    fullRefresh: overrides.fullRefresh ?? false,
    fetch,
    clock,
    ...(overrides.logger ? { logger: overrides.logger } : {}),
    ...(overrides.requestTimeoutMs ? { requestTimeoutMs: overrides.requestTimeoutMs } : {}),
  });
  return { http, requests, clock };
}

describe("HttpClient", () => {
  it("sends the project User-Agent and returns the body", async () => {
    const { http, requests } = client([html()]);
    const result = await http.get("/wiki/Boosters");

    expect(result).toMatchObject({ status: 200, fromCache: false, url: `${BASE}/wiki/Boosters` });
    expect(result.body.toString()).toBe(PAGE);
    expect(requests[0]?.headers.get("user-agent")).toBe(UA);
    expect(http.stats).toEqual({
      requests: 1,
      notModified: 0,
      bytes: PAGE.length,
      retries: 0,
      pauses: 0,
    });
  });

  it("revalidates with the cached validators and reuses the body on 304", async () => {
    const lastModified = "Mon, 14 Sep 2026 10:00:00 GMT";
    const first = client([html(PAGE, { etag: '"abc"', "last-modified": lastModified })]);
    await first.http.get("/wiki/Boosters");

    const second = client([new Response(null, { status: 304 })]);
    const result = await second.http.get("/wiki/Boosters");

    expect(second.requests[0]?.headers.get("if-none-match")).toBe('"abc"');
    expect(second.requests[0]?.headers.get("if-modified-since")).toBe(lastModified);
    expect(result).toMatchObject({ status: 304, fromCache: true, lastModified });
    expect(result.body.toString()).toBe(PAGE);
    expect(second.http.stats).toMatchObject({ requests: 1, notModified: 1, bytes: 0 });
  });

  it("skips validators on a full refresh", async () => {
    await client([html(PAGE, { etag: '"abc"' })]).http.get("/wiki/Boosters");
    const refresh = client([html()], { fullRefresh: true });
    await refresh.http.get("/wiki/Boosters");

    expect(refresh.requests[0]?.headers.has("if-none-match")).toBe(false);
  });

  it("skips validators for a page asked fresh, and caches what comes back", async () => {
    await client([html(PAGE, { etag: '"abc"' })]).http.get("/wiki/Stratagems");
    const newer = PAGE.replace("Boosters", "Boosters and TD-110 Maelstrom");
    const fresh = client([html(newer, { etag: '"abc"' })]);
    const result = await fresh.http.get("/wiki/Stratagems", { fresh: true });

    expect(fresh.requests[0]?.headers.has("if-none-match")).toBe(false);
    expect(result).toMatchObject({ status: 200, fromCache: false });
    expect(result.body.toString()).toBe(newer);
    // The next plain request revalidates against the body just fetched.
    const later = client([new Response(null, { status: 304 })]);
    expect((await later.http.get("/wiki/Stratagems")).body.toString()).toBe(newer);
  });

  it("retries network errors, 5xx and 429 with backoff, honoring Retry-After", async () => {
    const { http, clock } = client([
      new Error("socket hang up"),
      new Response(null, { status: 502 }),
      new Response(null, { status: 429, headers: { "retry-after": "90" } }),
      html(),
    ]);
    const result = await http.get("/wiki/Boosters");

    expect(result.status).toBe(200);
    // retry waits 5 s, 20 s, max(60 s, 90 s); the queue gap (3 s) is already covered.
    expect(clock.sleeps).toEqual([5_000, 20_000, 90_000]);
    expect(http.stats).toMatchObject({ requests: 4, retries: 3 });
  });

  it("gives up after the last retry", async () => {
    const { http } = client([
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
    ]);
    await expect(http.get("/wiki/Boosters")).rejects.toThrow(HttpError);
  });

  it("uses recent validated HTML after four 502s and reports the fallback", async () => {
    const warnings: string[] = [];
    await client([html()]).http.get("/wiki/Boosters");
    const { http, clock } = client(
      Array.from({ length: 4 }, () => new Response(null, { status: 502 })),
      {
        logger: {
          info() {},
          warn(msg) {
            warnings.push(msg);
          },
          error() {},
        },
      },
    );
    const result = await http.get("/wiki/Boosters", { staleIfError: true });
    expect(result).toMatchObject({ status: 200, fromCache: true, stale: true });
    expect(result.body.toString()).toBe(PAGE);
    expect(clock.sleeps).toEqual([5_000, 20_000, 60_000]);
    expect(http.stats).toMatchObject({ requests: 4, retries: 3, notModified: 0 });
    expect(http.warnings).toHaveLength(1);
    expect(warnings).toContain("http stale fallback");
  });

  it("OnlineSource enables fallback only for item pages", async () => {
    const { http } = client([]);
    const called: unknown[] = [];
    http.get = async (_target, options) => {
      called.push(options);
      return {
        url: `${BASE}/wiki/Boosters`,
        status: 200,
        body: Buffer.from(PAGE),
        fromCache: false,
        lastModified: null,
      };
    };
    const source = new OnlineSource(http, ["Weapons"]);
    await source.page("Boosters");
    await source.page("Weapons");
    expect(called).toEqual([
      { fresh: false, staleIfError: true },
      { fresh: true, staleIfError: false },
    ]);
  });

  it.each([500, 502, 504])("permits fallback for HTTP %s", async (status) => {
    await client([html()]).http.get("/wiki/Boosters");
    const { http } = client(Array.from({ length: 4 }, () => new Response(null, { status })));
    expect((await http.get("/wiki/Boosters", { staleIfError: true })).stale).toBe(true);
  });

  it.each([403, 429, 503])("never falls back after HTTP %s", async (status) => {
    await client([html()]).http.get("/wiki/Boosters");
    const { http } = client(Array.from({ length: 4 }, () => new Response(null, { status })));
    await expect(http.get("/wiki/Boosters", { staleIfError: true })).rejects.toThrow();
    expect(http.warnings).toEqual([]);
  });

  it("requires explicit opt-in, a cache body, and a non-fresh normal page", async () => {
    await client([html()]).http.get("/wiki/Boosters");
    for (const options of [{}, { staleIfError: true, fresh: true }]) {
      const { http } = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
      await expect(http.get("/wiki/Boosters", options)).rejects.toThrow(HttpError);
    }
    const full = client(
      Array.from({ length: 4 }, () => new Response(null, { status: 502 })),
      { fullRefresh: true },
    );
    await expect(full.http.get("/wiki/Boosters", { staleIfError: true })).rejects.toThrow(
      HttpError,
    );
    const missing = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    await expect(missing.http.get("/wiki/Missing", { staleIfError: true })).rejects.toThrow(
      HttpError,
    );
    const immutable = client([]);
    expect(
      (await immutable.http.get("/wiki/Boosters", { staleIfError: true, immutable: true })).stale,
    ).toBeUndefined();
    expect(immutable.requests).toHaveLength(0);
  });

  it("rejects old and invalid cached HTML", async () => {
    const cache = new HttpCache(join(dir, "http"));
    const url = `${BASE}/wiki/Boosters`;
    await cache.put(
      url,
      { etag: null, lastModified: null },
      Buffer.from(PAGE),
      1_000_000 - 8 * 24 * 60 * 60 * 1000,
    );
    const old = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    await expect(old.http.get(url, { staleIfError: true })).rejects.toThrow(HttpError);
    await cache.put(
      url,
      { etag: null, lastModified: null },
      Buffer.from("<html>blocked</html>"),
      1_000_000,
    );
    const invalid = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    await expect(invalid.http.get(url, { staleIfError: true })).rejects.toThrow(HttpError);
  });

  it("uses legacy body mtime and never refreshes cache age on 304 or fallback", async () => {
    const url = `${BASE}/wiki/Boosters`;
    await client([html()]).http.get(url);
    const key = createHash("sha1").update(url).digest("hex");
    const metaPath = join(dir, "http", `${key}.json`);
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    delete meta.fetchedAt;
    await writeFile(metaPath, JSON.stringify(meta));
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(join(dir, "http", `${key}.body`), oldDate, oldDate);
    const revalidate = client([new Response(null, { status: 304 })]);
    await revalidate.http.get(url);
    const failed = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    await expect(failed.http.get(url, { staleIfError: true })).rejects.toThrow(HttpError);
    expect(failed.http.warnings).toEqual([]);
  });

  it("accepts a recent legacy cache entry restored by Actions", async () => {
    const url = `${BASE}/wiki/Boosters`;
    await client([html()]).http.get(url);
    const key = createHash("sha1").update(url).digest("hex");
    const metaPath = join(dir, "http", `${key}.json`);
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    delete meta.fetchedAt;
    await writeFile(metaPath, JSON.stringify(meta));
    const { http } = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    expect((await http.get(url, { staleIfError: true })).stale).toBe(true);
  });

  it("limits fallback to three pages per client", async () => {
    const cache = new HttpCache(join(dir, "http"));
    for (let i = 0; i < 4; i++) {
      await cache.put(
        `${BASE}/wiki/Page${i}`,
        { etag: null, lastModified: null },
        Buffer.from(PAGE),
        1_000_000,
      );
    }
    const { http } = client(Array.from({ length: 16 }, () => new Response(null, { status: 502 })));
    for (let i = 0; i < 3; i++) {
      expect((await http.get(`/wiki/Page${i}`, { staleIfError: true })).stale).toBe(true);
    }
    await expect(http.get("/wiki/Page3", { staleIfError: true })).rejects.toThrow(HttpError);
    expect(http.warnings).toHaveLength(3);
  });

  it("treats a timed-out request as a retryable network failure", async () => {
    await client([html()]).http.get("/wiki/Boosters");
    const http = new HttpClient({
      baseUrl: BASE,
      userAgent: UA,
      pacing,
      cache: new HttpCache(join(dir, "http")),
      fullRefresh: false,
      retryDelaysMs: [],
      requestTimeoutMs: 10,
      clock: fakeClock(),
      fetch: async (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        }),
    });
    expect((await http.get("/wiki/Boosters", { staleIfError: true })).stale).toBe(true);
  });

  it("times out while reading a stalled response body", async () => {
    await client([html()]).http.get("/wiki/Boosters");
    const http = new HttpClient({
      baseUrl: BASE,
      userAgent: UA,
      pacing,
      cache: new HttpCache(join(dir, "http")),
      fullRefresh: false,
      retryDelaysMs: [],
      requestTimeoutMs: 10,
      clock: fakeClock(),
      fetch: async (request) =>
        new Response(
          new ReadableStream({
            start(controller) {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              );
            },
          }),
          { status: 200 },
        ),
    });
    expect((await http.get("/wiki/Boosters", { staleIfError: true })).stale).toBe(true);
  });

  it("rejects corrupt cache metadata", async () => {
    const url = `${BASE}/wiki/Boosters`;
    await client([html()]).http.get(url);
    const key = createHash("sha1").update(url).digest("hex");
    await writeFile(join(dir, "http", `${key}.json`), "broken");
    const { http } = client(Array.from({ length: 4 }, () => new Response(null, { status: 502 })));
    await expect(http.get(url, { staleIfError: true })).rejects.toThrow(HttpError);
  });

  it("does not retry other client errors", async () => {
    const { http, requests } = client([new Response(null, { status: 404 })]);
    await expect(http.get("/wiki/Nope")).rejects.toThrow("HTTP 404");
    expect(requests).toHaveLength(1);
  });

  it("aborts on three consecutive 403/429/503", async () => {
    const { http, requests } = client([
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
      new Response(null, { status: 503 }),
    ]);
    await expect(http.get("/wiki/Boosters")).rejects.toThrow(BlockedError);
    expect(requests).toHaveLength(3);
  });

  it("aborts on a Cloudflare challenge without retrying", async () => {
    const { http, requests } = client([
      new Response("Just a moment...", { status: 403, headers: { "cf-mitigated": "challenge" } }),
    ]);
    await expect(http.get("/wiki/Boosters")).rejects.toThrow("cf-mitigated: challenge");
    expect(requests).toHaveLength(1);
  });

  it("aborts when a wiki page has no #mw-content-text", async () => {
    const { http } = client([html("<html><body>Checking your browser</body></html>")]);
    await expect(http.get("/wiki/Boosters")).rejects.toThrow("no #mw-content-text");
  });

  it("fetches versioned images and reuses a cached immutable body without a request", async () => {
    const png = new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png", etag: '"i1"' },
    });
    const first = client([png]);
    const path = "/images/thumb/A.png/512px-A.png?97e7bb";
    await first.http.get(path, { immutable: true });
    expect(first.requests[0]?.url).toBe(`${BASE}${path}`);
    expect(first.requests[0]?.headers.get("accept")).toBe("image/*");

    const second = client([]);
    const result = await second.http.get(path, { immutable: true });
    expect(result).toMatchObject({ status: 304, fromCache: true });
    expect([...result.body]).toEqual([137, 80, 78, 71]);
    expect(second.requests).toHaveLength(0);
    expect(second.http.stats.requests).toBe(0);
  });

  it.each([
    "/images/A.png?action=raw",
    "/images/A.png?97E7BB",
    "/wiki/Boosters?97e7bb",
    "/api.php?action=parse",
    "/index.php?title=Boosters",
    "/wiki/Boosters?redirect=no",
    "/wiki/File:Icon.svg",
    "/wiki/Special:Search",
    "https://example.com/wiki/Boosters",
    "/w/load.php",
  ])("refuses %s without a request", async (path) => {
    const { http, requests } = client([]);
    await expect(http.get(path)).rejects.toThrow(DisallowedUrlError);
    expect(requests).toHaveLength(0);
  });

  it("checks robots.txt and adopts a larger Crawl-delay", async () => {
    const { http, requests, clock } = client([html(), html()]);
    http.useRobots(
      parseRobots(
        `${BASE}/robots.txt`,
        "User-agent: *\nDisallow: /wiki/Secret\nCrawl-delay: 10",
        UA,
      ),
    );

    await expect(http.get("/wiki/Secret")).rejects.toThrow("robots.txt disallows it");
    await http.get("/wiki/Boosters");
    await http.get("/wiki/Armor");
    expect(requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([10_000]);
  });
});
