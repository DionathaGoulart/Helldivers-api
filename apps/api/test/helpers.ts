import { join } from "node:path";
import { readDatasetFiles } from "@hd2/schemas/node";
import { buildSite, type Site } from "../scripts/site/site.ts";
import { type AppOptions, createApp } from "../src/app.ts";
import type { CacheLike, Env } from "../src/context.ts";
import { RateCounter } from "../src/lib/counter.ts";

// Shared fixtures: the synthetic `data/v1` of packages/schemas and the site built from it.

export const DATASET_DIR = join(import.meta.dirname, "../../../packages/schemas/test/dataset");

let loaded: { files: Map<string, unknown>; site: Site } | undefined;

export async function syntheticSite(): Promise<{ files: Map<string, unknown>; site: Site }> {
  if (!loaded) {
    const { files, issues } = await readDatasetFiles(DATASET_DIR);
    if (issues.length > 0) throw new Error(JSON.stringify(issues));
    loaded = { files, site: buildSite(files) };
  }
  return loaded;
}

/** ASSETS binding serving the built dist: generated files first, then the copied data tree. */
export class FakeAssets {
  readonly requests: string[] = [];
  status = 200;

  constructor(
    readonly files: ReadonlyMap<string, unknown>,
    readonly site: Site,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    this.requests.push(path);
    if (this.status !== 200) return new Response("error", { status: this.status });
    const relative = path.slice(1);
    const generated = this.site.files.get(relative);
    if (generated !== undefined) return new Response(generated, { status: 200 });
    const data = this.files.get(relative.replace(/^v1\//, ""));
    if (data !== undefined) return new Response(JSON.stringify(data), { status: 200 });
    return new Response("not found", { status: 404 });
  }
}

export class MemoryCache implements CacheLike {
  readonly entries = new Map<string, Response>();
  readonly puts: string[] = [];

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.puts.push(request.url);
    this.entries.set(request.url, response);
  }
}

/** Rate limiting binding: allows `limit` requests per key, then refuses; records every key. */
export class FakeRateLimiter {
  readonly keys: string[] = [];
  readonly #counts = new Map<string, number>();

  constructor(readonly max: number) {}

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    this.keys.push(key);
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);
    return { success: count <= this.max };
  }
}

/** `LIMITER` Durable Object namespace: one real RateCounter per name, on a shared fake clock. */
export class FakeCounterNamespace {
  readonly objects = new Map<string, RateCounter>();
  clock = 1_000_000;

  idFromName(name: string): string {
    return name;
  }

  get(id: never): { fetch(url: string): Promise<Response> } {
    const name = id as string;
    let object = this.objects.get(name);
    if (!object) {
      object = new RateCounter(null, null, () => this.clock);
      this.objects.set(name, object);
    }
    const counter = object;
    return { fetch: (url: string) => counter.fetch(new Request(url)) };
  }
}

export class FakeExecutionContext {
  readonly pending: Promise<unknown>[] = [];
  readonly props = {};

  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
  }

  passThroughOnException(): void {}

  settle(): Promise<unknown[]> {
    return Promise.all(this.pending);
  }
}

/** Loose shape of JSON bodies in assertions (lists, queries, search, problems). */
export interface Body {
  meta: { count: number; total: number; [key: string]: unknown };
  data: ({ id: string; name: string; collection: string } & Record<string, unknown>)[];
  links: { self: string; next: string; prev: string };
  type: string;
  title: string;
  detail: string;
}

export const readBody = async (response: Response) => (await response.json()) as Body;

export interface Harness {
  site: Site;
  assets: FakeAssets;
  cache: MemoryCache;
  ctx: FakeExecutionContext;
  logs: string[];
  env: Env;
  get(path: string, headers?: Record<string, string>, method?: string): Promise<Response>;
}

export async function harness(
  options: Partial<AppOptions> = {},
  env: Partial<Env> = {},
): Promise<Harness> {
  const { files, site } = await syntheticSite();
  const assets = new FakeAssets(files, site);
  const cache = new MemoryCache();
  const ctx = new FakeExecutionContext();
  const logs: string[] = [];
  const app = createApp({
    build: site.build,
    cache: () => cache,
    log: (line) => logs.push(line),
    ...options,
  });
  const fullEnv: Env = { ASSETS: assets, ...env };
  return {
    site,
    assets,
    cache,
    ctx,
    logs,
    env: fullEnv,
    get: async (path, headers = {}, method = "GET") =>
      app.request(
        `https://helldivers-api.dionatha.com.br${path}`,
        { method, headers },
        fullEnv,
        ctx,
      ),
  };
}
