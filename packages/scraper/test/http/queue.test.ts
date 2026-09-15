import { describe, expect, it } from "vitest";
import { DEFAULT_PACING, PoliteQueue } from "../../src/http/queue.ts";
import { fakeClock } from "./fake-clock.ts";

const pacing = { delayMs: 3_000, jitterMs: 1_500, pauseEvery: 3, pauseMs: 60_000 };

describe("PoliteQueue", () => {
  it("uses the arch §6.2 pacing by default", () => {
    expect(DEFAULT_PACING).toEqual({
      delayMs: 3_000,
      jitterMs: 1_500,
      pauseEvery: 100,
      pauseMs: 60_000,
    });
  });

  it("waits delay + jitter after each response, measured from its end", async () => {
    const clock = fakeClock(0.5);
    const queue = new PoliteQueue(pacing, clock);

    await queue.run(async () => clock.advance(1_000));
    await queue.run(async () => clock.advance(200));
    clock.advance(4_000); // idle time counts toward the gap

    await queue.run(async () => undefined);
    // Jitter floor(0.5 × 1500) = 750: the second request waits 3750 ms, the third none.
    expect(clock.sleeps).toEqual([3_750]);
  });

  it("adds a long pause every N requests", async () => {
    const clock = fakeClock(0);
    const queue = new PoliteQueue(pacing, clock);

    for (let i = 0; i < 5; i += 1) {
      await queue.run(async () => undefined);
    }
    expect(clock.sleeps).toEqual([3_000, 3_000, 63_000, 3_000]);
    expect(queue.stats).toEqual({ requests: 5, pauses: 1, waitedMs: 72_000 });
  });

  it("runs one task at a time in FIFO order, also after failures", async () => {
    const clock = fakeClock(0);
    const queue = new PoliteQueue(pacing, clock);
    const events: string[] = [];
    let active = 0;

    const task = (name: string, fail = false) =>
      queue.run(async () => {
        active += 1;
        expect(active).toBe(1);
        events.push(name);
        await Promise.resolve();
        active -= 1;
        if (fail) throw new Error(name);
        return name;
      });

    const results = await Promise.allSettled([task("a"), task("b", true), task("c")]);
    expect(events).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(clock.sleeps).toEqual([3_000, 3_000]);
  });
});
