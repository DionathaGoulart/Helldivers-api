import type { Clock } from "./clock.ts";

export interface PacingOptions {
  delayMs: number; // after every response, including 304 and errors
  jitterMs: number; // random extra delay in [0, jitterMs)
  pauseEvery: number; // long pause after this many requests
  pauseMs: number;
}

// arch §6.2 / plan D27: 3 s + 0–1.5 s jitter, 60 s pause every 100 requests.
export const DEFAULT_PACING: PacingOptions = {
  delayMs: 3_000,
  jitterMs: 1_500,
  pauseEvery: 100,
  pauseMs: 60_000,
};

export interface QueueStats {
  requests: number;
  pauses: number;
  waitedMs: number;
}

/** Single FIFO queue with concurrency 1; the gap is measured from the end of each request. */
export class PoliteQueue {
  readonly stats: QueueStats = { requests: 0, pauses: 0, waitedMs: 0 };
  #tail: Promise<unknown> = Promise.resolve();
  #readyAt = Number.NEGATIVE_INFINITY;

  constructor(
    readonly pacing: PacingOptions,
    readonly clock: Clock,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(() => this.#execute(task));
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #execute<T>(task: () => Promise<T>): Promise<T> {
    const wait = this.#readyAt - this.clock.now();
    if (wait > 0) {
      this.stats.waitedMs += wait;
      await this.clock.sleep(wait);
    }
    try {
      return await task();
    } finally {
      this.stats.requests += 1;
      let gap = this.pacing.delayMs + Math.floor(this.clock.random() * this.pacing.jitterMs);
      if (this.stats.requests % this.pacing.pauseEvery === 0) {
        gap += this.pacing.pauseMs;
        this.stats.pauses += 1;
      }
      this.#readyAt = this.clock.now() + gap;
    }
  }
}
