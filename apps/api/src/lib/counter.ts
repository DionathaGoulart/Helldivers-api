// Exact counting (arch §8.6, ADR-012, ADR-013): one Durable Object, `LIMITER_NAME`, holds the
// day's budget and a fixed window per client bucket (`anon:<ip>`, `origin:<host>:<ip>`,
// `key:<id>`). Every request that reaches the Worker asks it once, so the budget follows the
// Worker's own daily count and the object never gets more requests than the Worker. Its state is
// one storage row, written on every request (Workers Free: 100,000 rows a day, more than the
// budget), so neither hibernation after 10 s idle nor a deploy forgets a window or the count.

export const LIMITER_NAME = "global";
const DAY_MS = 86_400_000;
const STATE_KEY = "state";

export interface Window {
  end: number; // ms
  count: number;
}

export interface Hit {
  allowed: boolean;
  remaining: number;
  reset: number; // whole seconds until the window (or the day) starts over
}

/** Counts one request against `limit` per `periodMs`; a request past the limit is not counted. */
export function hit(window: Window | undefined, now: number, limit: number, periodMs: number) {
  const current = window && now < window.end ? window : { end: now + periodMs, count: 0 };
  const allowed = current.count < limit;
  const next = allowed ? { end: current.end, count: current.count + 1 } : current;
  const reset = Math.max(1, Math.ceil((next.end - now) / 1000));
  return { window: next, hit: { allowed, remaining: limit - next.count, reset } };
}

export interface Budget {
  day: string; // UTC date, YYYY-MM-DD
  used: number;
}

/**
 * Counts one request against the day's budget. Refused requests count too: the Worker ran for
 * them. `cap` null counts without asking (preflights, refused methods, bad keys).
 */
export function spend(budget: Budget | undefined, now: number, cap: number | null) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = (budget?.day === day ? budget.used : 0) + 1;
  const reset = Math.max(1, Math.ceil(((Math.floor(now / DAY_MS) + 1) * DAY_MS - now) / 1000));
  const verdict =
    cap === null ? null : { allowed: used <= cap, remaining: Math.max(0, cap - used), reset };
  return { budget: { day, used }, hit: verdict };
}

/** What the Worker asks: its daily cap, and the client's window unless it has none. */
export interface Question {
  cap?: number;
  bucket?: string;
  limit?: number;
  period?: number; // s
}

/** `window` is null without a bucket, or when the budget already refused the request. */
export interface Verdict {
  budget: Hit | null;
  window: Hit | null;
}

interface State extends Budget {
  windows: Record<string, Window>;
}

/** Subset of `DurableObjectStorage`. */
export interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

/** The Durable Object: `GET /?cap=<n>&bucket=<b>&limit=<n>&period=<s>` → Verdict as JSON. */
export class RateCounter {
  #state: State | undefined;

  constructor(
    readonly ctx: { storage: CounterStorage },
    _env: unknown,
    readonly now: () => number = Date.now,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const number = (name: string) => (params.has(name) ? Number(params.get(name)) : null);
    const [cap, limit, period] = [number("cap"), number("limit"), number("period")];
    const bucket = params.get("bucket");
    if (cap !== null && !(cap > 0)) return new Response("bad cap", { status: 400 });
    if (bucket !== null && !(limit !== null && limit > 0 && period !== null && period > 0)) {
      return new Response("bad limit or period", { status: 400 });
    }

    // Input gates hold other requests while storage is read or written: one request at a time.
    const state = this.#state ??
      (await this.ctx.storage.get<State>(STATE_KEY)) ?? { day: "", used: 0, windows: {} };
    const now = this.now();
    const spent = spend(state, now, cap);
    const windows = Object.fromEntries(
      Object.entries(state.windows).filter(([, window]) => now < window.end),
    );
    let window: Hit | null = null;
    if (bucket !== null && limit !== null && period !== null && spent.hit?.allowed !== false) {
      const counted = hit(windows[bucket], now, limit, period * 1000);
      windows[bucket] = counted.window;
      window = counted.hit;
    }
    this.#state = { ...spent.budget, windows };
    await this.ctx.storage.put(STATE_KEY, this.#state);
    return Response.json({ budget: spent.hit, window } satisfies Verdict);
  }
}

/** Subset of the `LIMITER` Durable Object namespace binding. */
export interface CounterNamespace {
  idFromName(name: string): unknown;
  get(id: never): { fetch(url: string): Promise<Response> };
}

export async function ask(namespace: CounterNamespace, question: Question): Promise<Verdict> {
  const stub = namespace.get(namespace.idFromName(LIMITER_NAME) as never);
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(question)) {
    if (value !== undefined) query.set(name, String(value));
  }
  const response = await stub.fetch(`https://limiter/?${query}`);
  if (!response.ok) throw new Error(`counter answered HTTP ${response.status}`);
  return (await response.json()) as Verdict;
}
