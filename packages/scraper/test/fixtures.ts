import { join } from "node:path";
import { FixtureSource, type WikiPage } from "../src/source.ts";

export const FIXTURES_DIR = join(import.meta.dirname, "fixtures", "wiki");

const source = new FixtureSource(FIXTURES_DIR);

/** A saved wiki page (`pnpm fixtures:update`); tests never fetch. */
export function fixture(title: string): Promise<WikiPage> {
  return source.page(title);
}

/** Wraps an HTML fragment the way MediaWiki renders an article body. */
export function article(body: string, head = ""): string {
  return `<html><head>${head}</head><body><div id="mw-content-text"><div class="mw-content-ltr mw-parser-output">${body}</div></div></body></html>`;
}
