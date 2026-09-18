import { describe, expect, it } from "vitest";
import { hit, RateCounter } from "../src/lib/counter.ts";

describe("hit", () => {
  it("counts up to the limit in a fixed window, then refuses without counting", () => {
    let window = null;
    const seen: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const result = hit(window, 1_000 + i, 3, 60_000);
      window = result.window;
      seen.push(result.hit.allowed);
    }
    expect(seen).toEqual([true, true, true, false]);
    expect(window).toEqual({ start: 1_000, count: 3 });
    expect(hit(window, 31_000, 3, 60_000).hit).toEqual({ allowed: false, remaining: 0, reset: 30 });
  });

  it("starts a new window once the period has passed", () => {
    const full = { start: 0, count: 10 };
    expect(hit(full, 59_999, 10, 60_000).hit.allowed).toBe(false);
    expect(hit(full, 60_000, 10, 60_000)).toEqual({
      window: { start: 60_000, count: 1 },
      hit: { allowed: true, remaining: 9, reset: 60 },
    });
  });
});

describe("RateCounter", () => {
  it("keeps one window per object and answers JSON", async () => {
    let now = 0;
    const counter = new RateCounter(null, null, () => now);
    const ask = async () =>
      (await counter.fetch(new Request("https://counter/?limit=2&period=10"))).json();
    expect(await ask()).toEqual({ allowed: true, remaining: 1, reset: 10 });
    now = 4_000;
    expect(await ask()).toEqual({ allowed: true, remaining: 0, reset: 6 });
    expect(await ask()).toEqual({ allowed: false, remaining: 0, reset: 6 });
    now = 10_000;
    expect(await ask()).toEqual({ allowed: true, remaining: 1, reset: 10 });
    const bad = await counter.fetch(new Request("https://counter/?limit=0&period=10"));
    expect(bad.status).toBe(400);
  });
});
