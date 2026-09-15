/** Time source for pacing and backoff; tests inject a fake one. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number; // [0, 1)
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};
