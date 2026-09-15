import type { Clock } from "../../src/http/clock.ts";

export interface FakeClock extends Clock {
  sleeps: number[];
  advance(ms: number): void;
}

/** Sleeping advances time instantly; `random()` is fixed. */
export function fakeClock(random = 0): FakeClock {
  let time = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    random: () => random,
    advance: (ms) => {
      time += ms;
    },
  };
}
