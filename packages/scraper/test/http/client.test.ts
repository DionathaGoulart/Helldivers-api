import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockedError } from "../../src/http/block-detect.ts";
import { HttpCache } from "../../src/http/cache.ts";
import { DisallowedUrlError, HttpClient, HttpError } from "../../src/http/client.ts";
import { parseRobots } from "../../src/http/robots.ts";
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

function client(replies: Reply[], overrides: { fullRefresh?: boolean; cache?: boolean } = {}) {
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

  it.each([
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
