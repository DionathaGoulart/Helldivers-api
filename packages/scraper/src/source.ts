import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HttpClient } from "./http/client.ts";
import { fixtureFileName, normalizeTitle, titleToPath, wikiUrl } from "./wiki/title.ts";

// Where wiki HTML comes from: the polite HTTP client, or saved fixtures (`--offline`).

export interface WikiPage {
  title: string; // requested title, normalized
  url: string;
  html: string;
  fromCache: boolean; // 304 revalidation or fixture
  lastModified: string | null;
}

export interface WikiSource {
  readonly offline: boolean;
  robotsTxt(): Promise<string>;
  page(title: string): Promise<WikiPage>;
}

export class OnlineSource implements WikiSource {
  readonly offline = false;

  constructor(readonly http: HttpClient) {}

  async robotsTxt(): Promise<string> {
    return (await this.http.get("/robots.txt")).body.toString("utf8");
  }

  async page(title: string): Promise<WikiPage> {
    const normalized = normalizeTitle(title);
    const result = await this.http.get(titleToPath(normalized));
    return {
      title: normalized,
      url: result.url,
      html: result.body.toString("utf8"),
      fromCache: result.fromCache,
      lastModified: result.lastModified,
    };
  }
}

/** Serves each page once per run: armors and helmets share their pages (arch §4.3). */
export class MemoSource implements WikiSource {
  readonly offline: boolean;
  readonly #pages = new Map<string, Promise<WikiPage>>();

  constructor(readonly inner: WikiSource) {
    this.offline = inner.offline;
  }

  robotsTxt(): Promise<string> {
    return this.inner.robotsTxt();
  }

  page(title: string): Promise<WikiPage> {
    const normalized = normalizeTitle(title);
    let page = this.#pages.get(normalized);
    if (!page) {
      page = this.inner.page(normalized);
      this.#pages.set(normalized, page);
    }
    return page;
  }
}

export class MissingFixtureError extends Error {
  constructor(readonly title: string) {
    super(
      `no fixture for "${title}": run pnpm fixtures:update --pages ${normalizeTitle(title).replaceAll(" ", "_")}`,
    );
    this.name = "MissingFixtureError";
  }
}

/** Reads `test/fixtures/wiki/<Title>.html` and `robots.txt`; never touches the network. */
export class FixtureSource implements WikiSource {
  readonly offline = true;

  constructor(readonly dir: string) {}

  robotsTxt(): Promise<string> {
    return readFile(join(this.dir, "robots.txt"), "utf8");
  }

  async page(title: string): Promise<WikiPage> {
    const normalized = normalizeTitle(title);
    let html: string;
    try {
      html = await readFile(join(this.dir, fixtureFileName(normalized)), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new MissingFixtureError(normalized);
      }
      throw error;
    }
    return {
      title: normalized,
      url: wikiUrl(normalized),
      html,
      fromCache: true,
      lastModified: null,
    };
  }
}
