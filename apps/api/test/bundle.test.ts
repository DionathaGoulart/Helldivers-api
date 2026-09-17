import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { bundleWorker } from "../scripts/site/bundle.ts";
import {
  FakeAssets,
  FakeExecutionContext,
  MemoryCache,
  readBody,
  syntheticSite,
} from "./helpers.ts";

const dir = await mkdtemp(join(tmpdir(), "hd2-worker-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("bundleWorker", () => {
  it("builds a self-contained _worker.js that knows its dataset", async () => {
    const { files, site } = await syntheticSite();
    const outfile = join(dir, "_worker.js");
    const bytes = await bundleWorker(
      join(import.meta.dirname, "../src/worker.ts"),
      outfile,
      site.build,
    );
    expect(bytes).toBeGreaterThan(0);

    const cache = new MemoryCache();
    Object.assign(globalThis, { caches: { default: cache } });
    const worker = (await import(pathToFileURL(outfile).href)) as {
      default: { fetch(request: Request, env: object, ctx: object): Promise<Response> };
    };
    const ctx = new FakeExecutionContext();
    const response = await worker.default.fetch(
      new Request("https://helldivers-api.pages.dev/v1/query/boosters"),
      { ASSETS: new FakeAssets(files, site) },
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-data-version")).toBe(site.build.dataVersion);
    expect((await readBody(response)).meta.total).toBe(1);
    await ctx.settle();
    expect(cache.puts).toHaveLength(1);
  });
});
