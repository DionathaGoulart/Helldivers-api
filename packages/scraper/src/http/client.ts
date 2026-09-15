import { type Logger, silentLogger } from "../log.ts";
import { BlockDetector } from "./block-detect.ts";
import type { CachedResponse, HttpCache } from "./cache.ts";
import { type Clock, systemClock } from "./clock.ts";
import { type PacingOptions, PoliteQueue } from "./queue.ts";
import type { RobotsPolicy } from "./robots.ts";

// The only module that talks to the wiki (arch §0.4, §6.2).

export const RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000, 60_000];
const MAX_RETRY_AFTER_MS = 300_000;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    detail = `HTTP ${status}`,
  ) {
    super(`GET ${url} failed: ${detail}`);
    this.name = "HttpError";
  }
}

export class DisallowedUrlError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`refusing to fetch ${url}: ${reason}`);
    this.name = "DisallowedUrlError";
  }
}

/** Only `/wiki/<Title>`, `/images/…` and `/robots.txt` on the wiki host, never a query (arch §0.5). */
export function assertFetchable(url: URL, base: URL): void {
  if (url.origin !== base.origin) {
    throw new DisallowedUrlError(url.href, `not on ${base.origin}`);
  }
  if (url.search !== "") {
    throw new DisallowedUrlError(url.href, "query strings are never fetched");
  }
  const path = decodeURIComponent(url.pathname);
  const allowed =
    path === "/robots.txt" ||
    path.startsWith("/images/") ||
    (/^\/wiki\/[^/]/.test(path) && !/^\/wiki\/(File|Special|Category):/i.test(path));
  if (!allowed) {
    throw new DisallowedUrlError(url.href, "only /wiki/<Title>, /images/… and /robots.txt");
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  userAgent: string;
  pacing: PacingOptions;
  cache: HttpCache | null;
  fullRefresh: boolean;
  retryDelaysMs?: readonly number[];
  fetch?: (request: Request) => Promise<Response>;
  clock?: Clock;
  logger?: Logger;
}

export interface HttpResult {
  url: string; // after redirects
  status: 200 | 304;
  body: Buffer;
  fromCache: boolean;
  lastModified: string | null;
}

export interface HttpStats {
  requests: number;
  notModified: number;
  bytes: number;
  retries: number;
  pauses: number;
}

type Attempt =
  | { ok: true; response: Response; body: Buffer | null; ms: number }
  | { ok: false; error: unknown; ms: number };

const isRetryable = (status: number) => status === 429 || status >= 500;

function retryAfterMs(headers: Headers, now: number): number {
  const value = headers.get("retry-after")?.trim();
  if (!value) {
    return 0;
  }
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : 0;
}

export class HttpClient {
  readonly #base: URL;
  readonly #options: HttpClientOptions;
  readonly #fetch: (request: Request) => Promise<Response>;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #queue: PoliteQueue;
  readonly #blocks = new BlockDetector();
  readonly #stats = { requests: 0, notModified: 0, bytes: 0, retries: 0 };
  #robots: RobotsPolicy | null = null;

  constructor(options: HttpClientOptions) {
    this.#base = new URL(options.baseUrl);
    this.#options = options;
    this.#fetch = options.fetch ?? ((request) => fetch(request));
    this.#clock = options.clock ?? systemClock;
    this.#logger = options.logger ?? silentLogger;
    this.#queue = new PoliteQueue({ ...options.pacing }, this.#clock);
  }

  get stats(): HttpStats {
    return { ...this.#stats, pauses: this.#queue.stats.pauses };
  }

  /** Every later request is checked against robots.txt; a larger Crawl-delay wins. */
  useRobots(policy: RobotsPolicy): void {
    this.#robots = policy;
    const pacing = this.#queue.pacing;
    pacing.delayMs = Math.max(pacing.delayMs, policy.crawlDelayMs);
  }

  async get(target: string): Promise<HttpResult> {
    const url = new URL(target, this.#base);
    url.hash = "";
    assertFetchable(url, this.#base);
    if (this.#robots && !this.#robots.isAllowed(url.href)) {
      throw new DisallowedUrlError(url.href, "robots.txt disallows it");
    }

    const cached = this.#options.cache ? await this.#options.cache.get(url.href) : null;
    const headers = new Headers({
      "user-agent": this.#options.userAgent,
      accept: url.pathname.startsWith("/images/") ? "image/*" : "text/html, text/plain;q=0.9",
    });
    if (cached && !this.#options.fullRefresh) {
      if (cached.etag) headers.set("if-none-match", cached.etag);
      if (cached.lastModified) headers.set("if-modified-since", cached.lastModified);
    }

    const delays = this.#options.retryDelaysMs ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#queue.run(() => this.#attempt(url, headers));
      this.#stats.requests += 1;
      const retryDelay = delays[attempt];

      if (!result.ok) {
        const reason = result.error instanceof Error ? result.error.message : String(result.error);
        this.#logger.warn("http", { url: url.href, error: reason, ms: result.ms });
        if (retryDelay === undefined) {
          throw new HttpError(url.href, 0, reason);
        }
        await this.#retry(url, retryDelay, 0);
        continue;
      }

      const { response, body } = result;
      this.#logger.info("http", {
        url: url.href,
        status: response.status,
        ms: result.ms,
        fromCache: response.status === 304,
        bytes: body?.byteLength ?? 0,
      });
      this.#blocks.checkResponse(url.href, response.status, response.headers);

      if (response.status === 304) {
        return this.#notModified(url, cached);
      }
      if (response.status === 200 && body) {
        return this.#fresh(url, response, body);
      }
      if (isRetryable(response.status) && retryDelay !== undefined) {
        await this.#retry(url, retryDelay, retryAfterMs(response.headers, this.#clock.now()));
        continue;
      }
      throw new HttpError(url.href, response.status);
    }
  }

  async #attempt(url: URL, headers: Headers): Promise<Attempt> {
    const started = this.#clock.now();
    try {
      const response = await this.#fetch(new Request(url, { headers, redirect: "follow" }));
      let body: Buffer | null = null;
      if (response.status === 200) {
        body = Buffer.from(await response.arrayBuffer());
      } else {
        await response.body?.cancel();
      }
      return { ok: true, response, body, ms: this.#clock.now() - started };
    } catch (error) {
      return { ok: false, error, ms: this.#clock.now() - started };
    }
  }

  async #retry(url: URL, backoffMs: number, retryAfter: number): Promise<void> {
    const wait = Math.max(backoffMs, retryAfter);
    this.#stats.retries += 1;
    this.#logger.warn("http retry", { url: url.href, waitMs: wait });
    await this.#clock.sleep(wait);
  }

  #notModified(url: URL, cached: CachedResponse | null): HttpResult {
    if (!cached) {
      throw new HttpError(url.href, 304, "304 without a cached body");
    }
    this.#stats.notModified += 1;
    return {
      url: url.href,
      status: 304,
      body: cached.body,
      fromCache: true,
      lastModified: cached.lastModified,
    };
  }

  async #fresh(url: URL, response: Response, body: Buffer): Promise<HttpResult> {
    const finalUrl = response.url || url.href;
    if (new URL(finalUrl).pathname.startsWith("/wiki/")) {
      this.#blocks.checkWikiHtml(finalUrl, body.toString("utf8"));
    }
    this.#stats.bytes += body.byteLength;
    const lastModified = response.headers.get("last-modified");
    await this.#options.cache?.put(
      url.href,
      { etag: response.headers.get("etag"), lastModified },
      body,
    );
    return { url: finalUrl, status: 200, body, fromCache: false, lastModified };
  }
}
