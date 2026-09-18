import { describe, expect, it } from "vitest";
import { hit, RateCounter, spend, type Verdict, type Window } from "../src/lib/counter.ts";
import { MemoryStorage } from "./helpers.ts";

const DAY = 86_400_000;

describe("hit", () => {
  it("counts up to the limit in a fixed window, then refuses without counting", () => {
    let window: Window | undefined;
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const result = hit(window, 1_000 + i, 3, 60_000);
      window = result.window;
      seen.push(result.hit.allowed);
    }
    expect(seen).toEqual([true, true, true, false]);
    expect(window).toEqual({ end: 61_000, count: 3 });
    expect(hit(window, 31_000, 3, 60_000).hit).toEqual({ allowed: false, remaining: 0, reset: 30 });
  });

  it("starts a new window once the period has passed", () => {
    const full = { end: 60_000, count: 10 };
    expect(hit(full, 59_999, 10, 60_000).hit.allowed).toBe(false);
    expect(hit(full, 60_000, 10, 60_000)).toEqual({
      window: { end: 120_000, count: 1 },
      hit: { allowed: true, remaining: 9, reset: 60 },
    });
  });
});

describe("spend", () => {
  it("counts every request of the UTC day, refused ones included, up to the cap", () => {
    const now = 10 * DAY + 3_600_000; // 01:00 UTC
    const first = spend(undefined, now, 2);
    expect(first).toEqual({
      budget: { day: "1970-01-11", used: 1 },
      hit: { allowed: true, remaining: 1, reset: 82_800 },
    });
    const second = spend(first.budget, now, 2);
    expect(second.hit).toEqual({ allowed: true, remaining: 0, reset: 82_800 });
    const third = spend(second.budget, now, 2);
    expect(third).toEqual({
      budget: { day: "1970-01-11", used: 3 },
      hit: { allowed: false, remaining: 0, reset: 82_800 },
    });
    // A higher cap (unlimited keys) still has room.
    expect(spend(third.budget, now, 5).hit).toEqual({ allowed: true, remaining: 1, reset: 82_800 });
  });

  it("counts without a verdict when there is no cap, and starts over at 00:00 UTC", () => {
    expect(spend({ day: "1970-01-11", used: 7 }, 10 * DAY + 1, null)).toEqual({
      budget: { day: "1970-01-11", used: 8 },
      hit: null,
    });
    expect(spend({ day: "1970-01-11", used: 99 }, 11 * DAY - 1, 50).hit).toEqual({
      allowed: false,
      remaining: 0,
      reset: 1,
    });
    expect(spend({ day: "1970-01-11", used: 99 }, 11 * DAY, 50)).toEqual({
      budget: { day: "1970-01-12", used: 1 },
      hit: { allowed: true, remaining: 49, reset: 86_400 },
    });
  });
});

describe("RateCounter", () => {
  const setup = () => {
    const storage = new MemoryStorage();
    const clock = { now: 0 };
    const make = () => new RateCounter({ storage }, null, () => clock.now);
    return { storage, clock, make };
  };
  const ask = async (counter: RateCounter, query: string) =>
    (await (await counter.fetch(new Request(`https://limiter/?${query}`))).json()) as Verdict;

  it("keeps one window per bucket and the day's budget, and answers JSON", async () => {
    const { storage, clock, make } = setup();
    const counter = make();
    const a = "cap=100&bucket=anon%3Aa&limit=2&period=10";
    expect(await ask(counter, a)).toEqual({
      budget: { allowed: true, remaining: 99, reset: 86_400 },
      window: { allowed: true, remaining: 1, reset: 10 },
    });
    clock.now = 4_000;
    expect((await ask(counter, a)).window).toEqual({ allowed: true, remaining: 0, reset: 6 });
    expect((await ask(counter, a)).window).toEqual({ allowed: false, remaining: 0, reset: 6 });
    expect((await ask(counter, "cap=100&bucket=anon%3Ab&limit=2&period=10")).window).toEqual({
      allowed: true,
      remaining: 1,
      reset: 10,
    });
    // No bucket: the budget only (unlimited keys). No cap: counted, no verdict (preflights).
    expect(await ask(counter, "cap=100")).toEqual({
      budget: { allowed: true, remaining: 95, reset: 86_396 },
      window: null,
    });
    expect(await ask(counter, "")).toEqual({ budget: null, window: null });
    clock.now = 10_000;
    expect((await ask(counter, a)).window).toEqual({ allowed: true, remaining: 1, reset: 10 });
    expect(storage.writes).toBe(7);

    for (const bad of ["cap=0", "cap=x", "bucket=anon%3Aa", "bucket=anon%3Aa&limit=2&period=0"]) {
      expect((await counter.fetch(new Request(`https://limiter/?${bad}`))).status).toBe(400);
    }
  });

  it("refuses past the cap before touching the window", async () => {
    const { storage, make } = setup();
    const counter = make();
    const query = "cap=2&bucket=key%3Ak&limit=20&period=10";
    await ask(counter, query);
    await ask(counter, query);
    expect(await ask(counter, query)).toEqual({
      budget: { allowed: false, remaining: 0, reset: 86_400 },
      window: null,
    });
    const state = storage.values.get("state") as { used: number; windows: Record<string, Window> };
    expect(state.used).toBe(3);
    expect(state.windows["key:k"]?.count).toBe(2);
  });

  it("remembers the count and the windows across hibernation, and drops ended windows", async () => {
    const { storage, clock, make } = setup();
    const anon = "cap=100&bucket=anon%3Aa&limit=2&period=60";
    await ask(make(), anon);
    await ask(make(), "cap=100&bucket=origin%3Ah%3Ab&limit=10&period=10");
    clock.now = 20_000; // past 10 s idle: the object hibernated and forgot its memory
    const woken = make();
    expect(await ask(woken, anon)).toEqual({
      budget: { allowed: true, remaining: 97, reset: 86_380 },
      window: { allowed: true, remaining: 0, reset: 40 },
    });
    expect((await ask(woken, anon)).window).toEqual({ allowed: false, remaining: 0, reset: 40 });
    const state = storage.values.get("state") as { windows: Record<string, Window> };
    expect(Object.keys(state.windows)).toEqual(["anon:a"]);
  });
});
