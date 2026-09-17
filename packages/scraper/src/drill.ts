import { B2Error, type ImageStore } from "./images/b2.ts";
import type { WikiPage, WikiSource } from "./source.ts";
import { loadHtml } from "./wiki/html.ts";

// Rehearsals for the alert path (plan phase 7): `SCRAPER_DRILL=<kind> pnpm scrape --only boosters`
// breaks one thing on purpose, so a real run proves the guardrail fails, `data/v1` stays untouched
// and the right issue is opened. The wiki is fetched normally; only what comes back is spoiled.

export const DRILLS = [
  "parser-broken",
  "blocked",
  "count-drop",
  "images",
  "robots-changed",
] as const;

export type Drill = (typeof DRILLS)[number];

export function isDrill(value: string): value is Drill {
  return (DRILLS as readonly string[]).includes(value);
}

const DROP_RATIO = 0.3; // well past the 10 % guardrail

/** Empties the article body: every parser then misses its selector. */
function emptyArticle(html: string): string {
  const $ = loadHtml(html);
  // The block detector wants the container, so it is kept and only its content goes.
  $("#mw-content-text").html('<div class="mw-parser-output"></div>');
  return $.html();
}

/** Removes the last 30 % of the rows of every table: the index lists fewer items than yesterday. */
function dropRows(html: string): string {
  const $ = loadHtml(html);
  for (const table of $("table.wikitable").toArray()) {
    const rows = $(table).find("tr").slice(1);
    const keep = Math.ceil(rows.length * (1 - DROP_RATIO));
    rows.slice(keep).remove();
  }
  for (const grid of $(".item-grid, .itemgrid").toArray()) {
    const cells = $(grid).children();
    cells.slice(Math.ceil(cells.length * (1 - DROP_RATIO))).remove();
  }
  return $.html();
}

/** An unreviewed Content-Signal: the preflight refuses to scrape until a human reads it. */
function spoilRobots(robots: string): string {
  return `${robots.trimEnd()}\nContent-Signal: ai-train=no,search=no,use=no\n`;
}

/**
 * Spoils the first page of the run, which every pipeline starts from — its index. Later pages
 * are served untouched, so the failure is the one the drill asked for.
 */
export class DrillSource implements WikiSource {
  readonly offline: boolean;
  #firstPage = true;

  constructor(
    private readonly inner: WikiSource,
    private readonly kind: Drill,
  ) {
    this.offline = inner.offline;
  }

  async robotsTxt(): Promise<string> {
    const robots = await this.inner.robotsTxt();
    return this.kind === "robots-changed" ? spoilRobots(robots) : robots;
  }

  async page(title: string): Promise<WikiPage> {
    const page = await this.inner.page(title);
    if (!this.#firstPage) {
      return page;
    }
    this.#firstPage = false;
    if (this.kind === "parser-broken") {
      return { ...page, html: emptyArticle(page.html) };
    }
    if (this.kind === "count-drop") {
      return { ...page, html: dropRows(page.html) };
    }
    return page;
  }
}

/** Answers 429 to every request: three in a row are a block (arch §6.2). */
export function drillFetch(): (request: Request) => Promise<Response> {
  return (request) =>
    Promise.resolve(
      new Response("drill: too many requests", {
        status: 429,
        headers: { "retry-after": "0", "x-drill": request.url },
      }),
    );
}

/** Refuses every upload: the images step fails and no entity points at a missing picture. */
export function drillStore(store: ImageStore): ImageStore {
  return {
    exists: (key) => store.exists(key),
    put: (key) => Promise.reject(new B2Error("PUT", key, 500, "drill: upload refused")),
    delete: (key) => store.delete(key),
  };
}
