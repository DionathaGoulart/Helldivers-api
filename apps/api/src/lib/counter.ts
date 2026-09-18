// Exact per-client counting (arch §8.6, ADR-012): one Durable Object per bucket (`anon:<ip>`,
// `origin:<host>:<ip>`, `key:<id>`) holds a fixed window in memory. The rate limiting binding
// counts per machine and lets a client that opens a new connection per request through; this
// object is the single count every machine asks. Nothing is written to storage: an object only
// forgets its window after it has sat idle, by which time the window has passed anyway.

export interface Window {
  start: number; // ms
  count: number;
}

export interface Hit {
  allowed: boolean;
  remaining: number;
  reset: number; // whole seconds until the window starts over
}

/** Counts one request against `limit` per `periodMs`; a request past the limit is not counted. */
export function hit(window: Window | null, now: number, limit: number, periodMs: number) {
  const current = window && now - window.start < periodMs ? window : { start: now, count: 0 };
  const allowed = current.count < limit;
  const next = allowed ? { start: current.start, count: current.count + 1 } : current;
  const reset = Math.max(1, Math.ceil((next.start + periodMs - now) / 1000));
  return { window: next, hit: { allowed, remaining: limit - next.count, reset } };
}

/** The Durable Object: `GET /?limit=<n>&period=<s>` → Hit as JSON. */
export class RateCounter {
  #window: Window | null = null;

  constructor(
    _state: unknown,
    _env: unknown,
    readonly now: () => number = Date.now,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit"));
    const period = Number(params.get("period"));
    if (!(limit > 0 && period > 0)) return new Response("bad limit or period", { status: 400 });
    const result = hit(this.#window, this.now(), limit, period * 1000);
    this.#window = result.window;
    return Response.json(result.hit);
  }
}

/** Subset of the `LIMITER` Durable Object namespace binding. */
export interface CounterNamespace {
  idFromName(name: string): unknown;
  get(id: never): { fetch(url: string): Promise<Response> };
}

export async function countHit(
  namespace: CounterNamespace,
  bucket: string,
  limit: number,
  period: number,
): Promise<Hit> {
  const stub = namespace.get(namespace.idFromName(bucket) as never);
  const response = await stub.fetch(`https://counter/?limit=${limit}&period=${period}`);
  if (!response.ok) throw new Error(`counter answered HTTP ${response.status}`);
  return (await response.json()) as Hit;
}
