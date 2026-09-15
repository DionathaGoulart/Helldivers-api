// Signals that the wiki (or its Cloudflare edge) is refusing us (arch §6.2).
// A block aborts the whole run with no retries: pushing on would only make it worse.

const BLOCK_STATUSES = new Set([403, 429, 503]);
const MAX_CONSECUTIVE = 3;

export class BlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`blocked while fetching ${url}: ${reason}`);
    this.name = "BlockedError";
  }
}

export class BlockDetector {
  #consecutive = 0;

  /** Throws on a challenge header or on the third 403/429/503 in a row. */
  checkResponse(url: string, status: number, headers: Headers): void {
    if (headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge") {
      throw new BlockedError(url, "cf-mitigated: challenge");
    }
    if (!BLOCK_STATUSES.has(status)) {
      this.#consecutive = 0;
      return;
    }
    this.#consecutive += 1;
    if (this.#consecutive >= MAX_CONSECUTIVE) {
      throw new BlockedError(
        url,
        `${MAX_CONSECUTIVE} consecutive ${[...BLOCK_STATUSES].join("/")}`,
      );
    }
  }

  /** A wiki page without its content container is an interstitial, not an article. */
  checkWikiHtml(url: string, html: string): void {
    if (!/\bid=["']?mw-content-text\b/.test(html)) {
      throw new BlockedError(url, "HTML has no #mw-content-text");
    }
  }
}
