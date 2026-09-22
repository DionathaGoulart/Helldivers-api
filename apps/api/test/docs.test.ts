import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Collection } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { ERRORS_URL, PROBLEM_TYPES } from "../src/lib/problem.ts";
import { REPO_URL, SITE_URL } from "../src/site.ts";
import { DAILY_BUDGET, TIERS } from "../src/spec/access.ts";

// The pages of `apps/docs` are hand-written (arch §9) while the data they point at is generated,
// so these tests hold the two together: a new collection needs a card, a new problem type needs a
// section, and the skin rules of the styleguide stay enforced.

const DOCS_DIR = join(import.meta.dirname, "../../docs");
const page = (name: string) => readFile(join(DOCS_DIR, name), "utf8");

const PAGES = [
  "index.html",
  "404.html",
  "docs/index.html",
  "docs/errors.html",
  "docs/access.html",
  "examples.html",
  "new.html",
];

/** The site nav, in order, on every page but the 404; each page marks its own link. */
const NAV = ["/", "/docs/", "/docs/access", "/docs/errors", "/examples", "/new", REPO_URL];
const OWN_LINK: Record<string, string> = {
  "index.html": "/",
  "docs/index.html": "/docs/",
  "docs/access.html": "/docs/access",
  "docs/errors.html": "/docs/errors",
  "examples.html": "/examples",
  "new.html": "/new",
};

describe("docs site", () => {
  it("lists a card per collection on the landing page", async () => {
    const html = await page("index.html");
    for (const collection of Collection.options) {
      expect(html).toContain(`data-collection="${collection}"`);
      expect(html).toContain(`href="/v1/${collection}.json"`);
      expect(html).toContain(`${collection.toUpperCase()}.JSON`);
    }
  });

  it("opens the API client from the generated document", async () => {
    const html = await page("index.html");
    expect(html).toContain(
      `https://fetch.usebruno.com?url=${SITE_URL}/v1/openapi.json&amp;type=openapi`,
    );
  });

  it("shows every collection on the examples page, in the code and in the requests", async () => {
    const html = await page("examples.html");
    const js = await page("examples.js");
    for (const collection of Collection.options) {
      // The snippet a reader sees and the loader that runs it both ask for the collection.
      const path = new RegExp(`"/${collection}[/.]|\`/${collection}/`);
      expect({ collection, html: path.test(html), js: path.test(js) }).toEqual({
        collection,
        html: true,
        js: true,
      });
    }
    // A section without a loader stays a spinner; a loader without a section is dead code.
    const sections = [...html.matchAll(/<section class="stack ex-section" id="([a-z-]+)"/g)].map(
      (match) => match[1],
    );
    const loaders = [...js.matchAll(/^ {2}"?([a-z-]+)"?: \{$/gm)].map((match) => match[1]);
    expect(sections.sort()).toEqual(loaders.sort());
    expect(sections).toHaveLength(9);
  });

  it("keeps the same nav on every page and marks the page being read", async () => {
    for (const [name, own] of Object.entries(OWN_LINK)) {
      const html = await page(name);
      const nav = /<nav class="header-actions" aria-label="Site">([\s\S]*?)<\/nav>/.exec(html)?.[1];
      const links = [
        ...(nav ?? "").matchAll(/<a class="icon-btn" href="([^"]+)"( aria-current="page")?>/g),
      ];
      // The reference adds openapi.json after the shared links.
      expect({ name, hrefs: links.map((m) => m[1]).slice(0, NAV.length) }).toEqual({
        name,
        hrefs: NAV,
      });
      expect({ name, current: links.filter((m) => m[2]).map((m) => m[1]) }).toEqual({
        name,
        current: [own],
      });
    }
  });

  it("never redeclares a top-level name of app.js, which every page loads first", async () => {
    // Classic scripts share one global scope: a second `const status` is a SyntaxError and the
    // whole page script never runs.
    const names = (js: string) =>
      [...js.matchAll(/^(?:async )?(?:const|let|function) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const shared = new Set(names(await page("app.js")));
    for (const name of ["examples.js", "new.js"]) {
      expect({ name, clash: names(await page(name)).filter((n) => shared.has(n)) }).toEqual({
        name,
        clash: [],
      });
    }
  });

  it("builds /new from static files only, never the limited routes", async () => {
    const js = await page("new.js");
    expect(js).toContain('get("/all.json")');
    expect(js).toContain('get("/changelog.json")');
    expect(js).not.toMatch(/\/query\/|\/search/);
  });

  it("gives every problem type a section to link to", async () => {
    const html = await page("docs/errors.html");
    expect(ERRORS_URL).toBe(`${SITE_URL}/docs/errors`);
    for (const [type, { status, title }] of Object.entries(PROBLEM_TYPES)) {
      expect(html).toContain(`id="${type}"`);
      expect(html).toContain(`${status} · ${type.toUpperCase()}`);
      expect(title).toBeTruthy();
    }
    // A retired type loses its section too.
    const sections = [...html.matchAll(/<section class="panel" id="([a-z-]+)">/g)].map((m) => m[1]);
    expect(sections.sort()).toEqual(Object.keys(PROBLEM_TYPES).sort());
  });

  it("states the limits of every tier and the daily budget as src/spec/access.ts sets them", async () => {
    const html = await page("docs/access.html");
    for (const [tier, { limit, period }] of Object.entries(TIERS)) {
      const card = new RegExp(
        `data-tier="${tier}">[\\s\\S]*?<span class="stat-value">([^<]+)</span>`,
      );
      expect(card.exec(html)?.[1]).toBe(`${limit} / ${period} s`);
    }
    for (const name of ["shared", "warnBelow"] as const) {
      const value = new RegExp(`data-budget="${name}">([^<]+)</span>`).exec(html)?.[1];
      expect(value).toBe(String(DAILY_BUDGET[name]));
    }
  });

  it("pins the reference renderer by version and hash", async () => {
    const html = await page("docs/index.html");
    expect(html).toMatch(
      /cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@\d+\.\d+\.\d+\/dist\/browser\/standalone\.js/,
    );
    expect(html).toMatch(/integrity="sha384-[A-Za-z0-9+/]+"/);
    expect(html).toContain('crossorigin="anonymous"');
  });

  it("applies the theme before paint on every page", async () => {
    for (const name of PAGES) {
      const html = await page(name);
      const head = html.slice(0, html.indexOf("</head>"));
      // The inline script runs before the stylesheet paints, so the theme never flashes.
      expect(head).toContain('localStorage.getItem("hd2api-theme")');
      expect(head.indexOf("hd2api-theme")).toBeLessThan(head.indexOf("theme.css"));
      expect(html).toContain('<link rel="stylesheet" href="/theme.css" />');
    }
  });

  it("keeps every hex value in theme.css (styleguide §0.4)", async () => {
    for (const name of [...PAGES, "app.js", "docs/reference.js", "examples.js", "new.js"]) {
      expect({ name, hex: (await page(name)).match(/#[0-9a-fA-F]{6}\b/g) }).toEqual({
        name,
        hex: null,
      });
    }
    const css = await page("theme.css");
    expect(css.match(/#[0-9a-f]{6}\b/g)?.length).toBeGreaterThan(15);
    // Both themes, and the dark one is the default (styleguide §0.2).
    expect(css).toContain('[data-theme="yellow"]');
    expect(css).toContain('[data-theme="black"]');
  });

  it("holds the motifs the styleguide names", async () => {
    const css = await page("theme.css");
    for (const hook of [
      ".retro-border",
      ".retro-shadow",
      ".terminal-cursor",
      ".terminal-scanline",
      ".animate-enter",
      ".btn-goodchat",
      ".window-bar",
      ".screen-kicker",
      ".screen-pad",
    ]) {
      // Some hooks are declared in a group (`.screen-kicker, .section-label`) or on a
      // pseudo-element (`.terminal-cursor::after`), so the class itself is what is asserted.
      expect(css).toContain(hook);
    }
    expect(css).toContain("--radius: 0;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // §2.4: muted text is a colour, never opacity.
    expect(css).toContain("--muted-text:");
  });
});
