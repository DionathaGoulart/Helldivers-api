import { describe, expect, it } from "vitest";
import { runSmoke, type SmokeDeps, type SmokeOptions } from "../scripts/smoke/checks.ts";
import { PROBLEM_TYPES } from "../src/lib/problem.ts";

const VERSION = "2026-09-17.2d3c0c72";
const BUILD = "0123456789abcdef0123456789abcdef01234567";
const IMAGE = "/images/v1/weapons/ar-23-liberator.932ff63d.webp";
const cors = { "access-control-allow-origin": "*" };
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
/** The errors page as smoke wants it: one anchor per problem type. */
const errorsPage = () =>
  html(
    Object.keys(PROBLEM_TYPES)
      .map((slug) => `<section id="${slug}">`)
      .join(""),
  );
const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, ...headers } });

/** A healthy deployment; `overrides` replaces the answer for one path. */
function site(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const calls: string[] = [];
  const revalidating = (init?: RequestInit) => new Headers(init?.headers).has("if-none-match");
  const routes: Record<string, (init?: RequestInit) => Response> = {
    "/v1/meta.json": () =>
      json({ dataVersion: VERSION }, { "x-data-version": VERSION, "x-build-id": BUILD }),
    "/v1/weapons/ar-23-liberator.json": (init) =>
      revalidating(init)
        ? new Response(null, { status: 304 })
        : json(
            { data: { image: { url: IMAGE } } },
            { etag: '"abc"', "cache-control": "public, max-age=300" },
          ),
    "/v1/weapons/by-category/primary.json": () => json({ meta: { count: 54 } }),
    "/v1/weapons.csv": () =>
      new Response("id,slug,name,aliases\r\n", {
        headers: { "content-type": "text/csv; charset=utf-8" },
      }),
    "/v1/weapons": () =>
      new Response(null, { status: 301, headers: { location: "/v1/weapons.json" } }),
    "/v1/weapons/does-not-exist.json": () => new Response("<html>", { status: 404 }),
    "/": () => html("<html>landing</html>"),
    "/docs/": () => html("<html>reference</html>"),
    "/docs/errors": errorsPage,
    "/v1/openapi.json": () => json({ openapi: "3.1.0", "x-data-version": VERSION }),
    "/v1/query/weapons?category=primary": (init) =>
      revalidating(init)
        ? new Response(null, { status: 304 })
        : json(
            { meta: { total: 54 } },
            { "x-data-version": VERSION, etag: `W/"${VERSION}-0123456789abcdef"` },
          ),
    "/v1/query/weapons?category=primray": () =>
      new Response(JSON.stringify({ title: "Invalid filter value" }), {
        status: 400,
        headers: { "content-type": "application/problem+json" },
      }),
    "/v1/search?q=lib": () => json({ data: [{}] }),
    [IMAGE]: (init) =>
      revalidating(init)
        ? new Response(null, { status: 304 })
        : new Response(new Uint8Array([1]), {
            headers: {
              ...cors,
              "content-type": "image/webp",
              "cache-control": "public, max-age=31536000, immutable",
              etag: '"932ff63d"',
            },
          }),
    ...overrides,
  };
  let clock = 0;
  const lines: string[] = [];
  const deps: SmokeDeps = {
    fetch: async (url, init) => {
      const path = url.replace("https://example.test", "");
      calls.push(path);
      const route = routes[path];
      return route ? route(init) : new Response("unexpected", { status: 599 });
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (line) => lines.push(line),
  };
  return { deps, calls, lines };
}

const options: SmokeOptions = {
  base: "https://example.test/",
  dataVersion: VERSION,
  buildId: BUILD,
  skipImages: false,
  waitMs: 120_000,
  retryMs: 10_000,
};

describe("runSmoke", () => {
  it("passes against a healthy deployment", async () => {
    const { deps, lines } = site();
    expect(await runSmoke(options, deps)).toEqual([]);
    expect(lines.filter((line) => line.startsWith("ok"))).toHaveLength(12);
  });

  it("waits for the new dataVersion to reach the edge", async () => {
    let served = 0;
    const { deps, calls } = site({
      "/v1/meta.json": () =>
        json(
          { dataVersion: served++ < 2 ? "2026-09-16.00000000" : VERSION },
          { "x-data-version": VERSION, "x-build-id": BUILD },
        ),
    });
    expect(await runSmoke(options, deps)).toEqual([]);
    expect(calls.filter((path) => path === "/v1/meta.json")).toHaveLength(3);
  });

  it("gives up after the wait and keeps checking the rest", async () => {
    const { deps } = site({ "/v1/meta.json": () => json({ dataVersion: "2026-09-16.00000000" }) });
    expect(await runSmoke({ ...options, waitMs: 30_000 }, deps)).toEqual([
      `meta: dataVersion 2026-09-16.00000000, build none, expected ${VERSION} · ${BUILD}`,
    ]);
  });

  // The deploy that added /docs/ kept the dataVersion, so smoke tested the deployment it replaced.
  it("waits for the deployment even when the dataset did not change", async () => {
    let served = 0;
    const { deps, calls } = site({
      "/v1/meta.json": () =>
        json(
          { dataVersion: VERSION },
          { "x-data-version": VERSION, "x-build-id": served++ < 2 ? "older-deploy" : BUILD },
        ),
    });
    expect(await runSmoke(options, deps)).toEqual([]);
    expect(calls.filter((path) => path === "/v1/meta.json")).toHaveLength(3);
  });

  it("does not gate on the build id of a local build", async () => {
    const { deps } = site({
      "/v1/meta.json": () => json({ dataVersion: VERSION }, { "x-data-version": VERSION }),
    });
    expect(await runSmoke({ ...options, buildId: "dev" }, deps)).toEqual([]);
  });

  it("reports each broken behavior", async () => {
    const { deps } = site({
      "/v1/weapons": () => new Response("<html>", { status: 200 }), // _redirects missing
      "/v1/weapons/does-not-exist.json": () => new Response("<html>", { status: 200 }), // SPA fallback
      "/v1/query/weapons?category=primary": () => new Response("<html>", { status: 200 }), // run_worker_first
      [IMAGE]: () => json({}, {}, 503),
      "/docs/errors": () => html('<section id="not-found">'), // an anchor was dropped
    });
    expect(await runSmoke(options, deps)).toEqual([
      "redirect: HTTP 200",
      "missing file: HTTP 200",
      "docs pages: /docs/errors has no anchor for unknown-parameter, invalid-filter-value, " +
        "invalid-parameter, method-not-allowed, internal-error",
      "query + revalidation: access-control-allow-origin: expected *, got none",
      "image: HTTP 503",
    ]);
  });

  it("skips the image when asked", async () => {
    const { deps, calls, lines } = site();
    expect(await runSmoke({ ...options, skipImages: true }, deps)).toEqual([]);
    expect(calls).not.toContain(IMAGE);
    expect(lines.at(-1)).toBe("skip  image (--skip-images)");
  });
});
