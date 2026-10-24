import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("fingerprints code changes with unchanged dataset metadata deterministically", async () => {
    const { site } = await syntheticSite();
    const entry = join(dir, "fingerprint.ts");
    const outfile = join(dir, "fingerprint.js");
    const compile = async (behavior: number) => {
      await writeFile(
        entry,
        `export default { version: __BUILD_INFO__.responseVersion, behavior: ${behavior} };`,
      );
      await bundleWorker(entry, outfile, site.build);
      const code = await readFile(outfile, "utf8");
      const result = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
      );
      return result.default.version as string;
    };
    const first = await compile(1);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await compile(1)).toBe(first);
    expect(await compile(2)).not.toBe(first);
  });

  it("builds a self-contained worker.js that knows its dataset", async () => {
    const { files, site } = await syntheticSite();
    const outfile = join(dir, "worker.js");
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
      new Request("https://helldivers-api.dionatha.com.br/v1/query/boosters"),
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
