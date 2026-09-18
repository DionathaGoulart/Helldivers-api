import { PROBLEM_TYPES } from "../../src/lib/problem.ts";

// Post-deploy checks (arch §11 Smoke, plan D29): the static host (`_headers`, `_redirects`,
// `run_worker_first`, ETag/304) and the Worker, as a client sees them.

export interface SmokeOptions {
  base: string; // https://helldivers-api.dionatha.com.br or http://localhost:8000
  dataVersion: string; // expected in /v1/meta.json
  buildId: string; // expected in the X-Build-Id header; `dev` waits on the dataset only
  skipImages: boolean; // a build without `pnpm images:pull` has no images
  apiKey: string | null; // sent on the dynamic checks; null checks them anonymously
  waitMs: number; // how long a new deploy may take to reach the edge
  retryMs: number;
}

export interface SmokeDeps {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
}

export const ITEM_PATH = "/v1/weapons/ar-23-liberator.json";

/** Well formed, signed by nobody: a deployment that checks keys answers 401. */
export const BAD_KEY = `hd2_000000000000_${"A".repeat(43)}`;

/** Every problem type has a section on `/docs/errors` (arch §8.3, plan §8 Phase 6). */
const PROBLEM_SLUGS = Object.keys(PROBLEM_TYPES);

class CheckError extends Error {}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckError(message);
}

function expectHeader(response: Response, name: string, expected: string | RegExp) {
  const value = response.headers.get(name);
  const ok =
    typeof expected === "string" ? value === expected : value !== null && expected.test(value);
  expect(ok, `${name}: expected ${String(expected)}, got ${value ?? "none"}`);
}

/** Runs every check and returns the failures (empty = green). */
export async function runSmoke(options: SmokeOptions, deps: SmokeDeps): Promise<string[]> {
  const base = options.base.replace(/\/+$/, "");
  const failures: string[] = [];

  const request = async (path: string, init: RequestInit = {}) => {
    const started = deps.now();
    const response = await deps.fetch(`${base}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
    return { response, ms: Math.round(deps.now() - started) };
  };

  const check = async (name: string, run: () => Promise<string>) => {
    try {
      const detail = await run();
      deps.log(`ok    ${name} · ${detail}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${reason}`);
      deps.log(`FAIL  ${name} · ${reason}`);
    }
  };

  // The dynamic checks run as the smoke key when there is one, so they never eat the anon budget.
  const auth: Record<string, string> = options.apiKey
    ? { Authorization: `Bearer ${options.apiKey}` }
    : {};
  const tier = options.apiKey ? "key" : "anon";

  let item: { data: { image: { url: string } | null } } | undefined;

  // Waits for the deployment under test, then checks it. A code- or docs-only deploy keeps the
  // dataVersion, so the build id is what tells the new deployment from the one it replaces.
  await check("meta", async () => {
    const deadline = deps.now() + options.waitMs;
    const gateBuild = options.buildId !== "dev";
    for (;;) {
      const { response, ms } = await request("/v1/meta.json");
      const body = response.ok ? ((await response.json()) as { dataVersion?: string }) : {};
      const served = response.headers.get("x-build-id");
      const stale: string[] = [];
      if (body.dataVersion !== options.dataVersion) {
        stale.push(`dataVersion ${body.dataVersion ?? `HTTP ${response.status}`}`);
      }
      if (gateBuild && served !== options.buildId) stale.push(`build ${served ?? "none"}`);
      if (stale.length === 0) {
        expectHeader(response, "access-control-allow-origin", "*");
        expectHeader(response, "x-data-version", options.dataVersion);
        return `${response.status} ${options.dataVersion} ${ms} ms`;
      }
      expect(
        deps.now() + options.retryMs <= deadline,
        `${stale.join(", ")}, expected ${options.dataVersion}${gateBuild ? ` · ${options.buildId}` : ""}`,
      );
      await deps.sleep(options.retryMs);
    }
  });

  await check("item + revalidation", async () => {
    const { response, ms } = await request(ITEM_PATH);
    expect(response.status === 200, `HTTP ${response.status}`);
    expectHeader(response, "access-control-allow-origin", "*");
    expectHeader(response, "cache-control", /max-age=300/);
    const etag = response.headers.get("etag");
    expect(etag, "no ETag");
    item = (await response.json()) as typeof item;
    const revalidated = await request(ITEM_PATH, { headers: { "If-None-Match": etag } });
    expect(revalidated.response.status === 304, `revalidation HTTP ${revalidated.response.status}`);
    return `200 ${ms} ms · 304 ${revalidated.ms} ms`;
  });

  await check("facet", async () => {
    const { response, ms } = await request("/v1/weapons/by-category/primary.json");
    expect(response.status === 200, `HTTP ${response.status}`);
    const body = (await response.json()) as { meta: { count: number } };
    expect(body.meta.count > 0, "empty facet");
    return `200 ${body.meta.count} items ${ms} ms`;
  });

  await check("csv", async () => {
    const { response, ms } = await request("/v1/weapons.csv");
    expect(response.status === 200, `HTTP ${response.status}`);
    expectHeader(response, "content-type", /^text\/csv/);
    expect((await response.text()).startsWith("id,slug,name,"), "unexpected header row");
    return `200 ${ms} ms`;
  });

  await check("redirect", async () => {
    const { response, ms } = await request("/v1/weapons");
    expect(response.status === 301, `HTTP ${response.status}`);
    expectHeader(response, "location", /\/v1\/weapons\.json$/);
    return `301 ${ms} ms`;
  });

  await check("missing file", async () => {
    const { response, ms } = await request("/v1/weapons/does-not-exist.json");
    expect(response.status === 404, `HTTP ${response.status}`);
    return `404 ${ms} ms`;
  });

  // The problem `type` of every error points at an anchor on this page (arch §8.3); a page that
  // stopped being served, or lost an anchor, breaks that link for everybody.
  await check("docs pages", async () => {
    const pages = ["/", "/docs/", "/docs/errors", "/docs/access", "/examples"];
    const times: string[] = [];
    let errorsHtml = "";
    for (const path of pages) {
      const { response, ms } = await request(path);
      expect(response.status === 200, `${path}: HTTP ${response.status}`);
      expectHeader(response, "content-type", /^text\/html/);
      const html = await response.text();
      if (path === "/docs/errors") errorsHtml = html;
      times.push(`${path} ${ms} ms`);
    }
    const missing = PROBLEM_SLUGS.filter((slug) => !errorsHtml.includes(`id="${slug}"`));
    expect(missing.length === 0, `/docs/errors has no anchor for ${missing.join(", ")}`);
    return times.join(" · ");
  });

  await check("openapi", async () => {
    const { response, ms } = await request("/v1/openapi.json");
    expect(response.status === 200, `HTTP ${response.status}`);
    const body = (await response.json()) as { openapi?: string; "x-data-version"?: string };
    expect(body.openapi === "3.1.0", `openapi ${body.openapi}`);
    expect(
      body["x-data-version"] === options.dataVersion,
      `x-data-version ${body["x-data-version"]}`,
    );
    return `200 ${ms} ms`;
  });

  await check("query + revalidation", async () => {
    const path = "/v1/query/weapons?category=primary";
    const { response, ms } = await request(path, { headers: auth });
    expect(response.status === 200, `HTTP ${response.status}`);
    expectHeader(response, "access-control-allow-origin", "*");
    expectHeader(response, "x-data-version", options.dataVersion);
    expectHeader(response, "x-api-tier", tier);
    expectHeader(
      response,
      "ratelimit-policy",
      new RegExp(`^"${tier}";q=\\d+;w=\\d+, "daily";q=\\d+;w=86400$`),
    );
    // Only the LIMITER Durable Object knows the day's budget: its item proves it answered.
    expectHeader(
      response,
      "ratelimit",
      new RegExp(`^"${tier}";r=\\d+;t=\\d+, "daily";r=\\d+;t=\\d+$`),
    );
    expectHeader(
      response,
      "etag",
      new RegExp(`^W/"${options.dataVersion.replace(".", "\\.")}-[a-f0-9]{16}"$`),
    );
    const body = (await response.json()) as { meta: { total: number } };
    expect(body.meta.total > 0, "no primary weapons");
    const revalidated = await request(path, {
      headers: { ...auth, "If-None-Match": response.headers.get("etag") ?? "" },
    });
    expect(revalidated.response.status === 304, `revalidation HTTP ${revalidated.response.status}`);
    return `200 ${body.meta.total} items ${ms} ms · 304 ${revalidated.ms} ms`;
  });

  await check("invalid filter", async () => {
    const { response, ms } = await request("/v1/query/weapons?category=primray", {
      headers: auth,
    });
    expect(response.status === 400, `HTTP ${response.status}`);
    expectHeader(response, "content-type", "application/problem+json");
    const body = (await response.json()) as { title?: string };
    expect(body.title === "Invalid filter value", `title ${body.title}`);
    return `400 ${ms} ms`;
  });

  await check("search", async () => {
    const { response, ms } = await request("/v1/search?q=lib", { headers: auth });
    expect(response.status === 200, `HTTP ${response.status}`);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data.length > 0, "no results");
    return `200 ${body.data.length} results ${ms} ms`;
  });

  // A deployment without API_KEY_SECRET would let this through as anonymous.
  await check("invalid key", async () => {
    const { response, ms } = await request("/v1/search?q=lib", {
      headers: { Authorization: `Bearer ${BAD_KEY}` },
    });
    expect(response.status === 401, `HTTP ${response.status}`);
    expectHeader(response, "www-authenticate", /^Bearer /);
    expectHeader(response, "content-type", "application/problem+json");
    return `401 ${ms} ms`;
  });

  if (options.skipImages) {
    deps.log("skip  image (--skip-images)");
  } else {
    await check("image", async () => {
      const url = item?.data.image?.url;
      expect(url, `${ITEM_PATH} has no image`);
      const first = await request(url);
      expect(first.response.status === 200, `HTTP ${first.response.status}`);
      expectHeader(first.response, "content-type", "image/webp");
      expectHeader(first.response, "cache-control", "public, max-age=31536000, immutable");
      expectHeader(first.response, "access-control-allow-origin", "*");
      await first.response.arrayBuffer();
      const second = await request(url);
      expect(second.response.status === 200, `second HTTP ${second.response.status}`);
      await second.response.arrayBuffer();
      const etag = first.response.headers.get("etag") ?? "";
      const revalidated = await request(url, { headers: { "If-None-Match": etag } });
      expect(
        revalidated.response.status === 304,
        `revalidation HTTP ${revalidated.response.status}`,
      );
      return `200 ${first.ms} ms · 200 ${second.ms} ms · 304 ${revalidated.ms} ms`;
    });
  }

  return failures;
}
