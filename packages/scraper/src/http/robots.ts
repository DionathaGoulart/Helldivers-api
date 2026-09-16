import robotsParser from "robots-parser";

export interface RobotsPolicy {
  isAllowed(url: string): boolean;
  /** Crawl-delay for our user agent (or `*`) in ms; 0 when absent. */
  crawlDelayMs: number;
  /** Normalized `Content-Signal` values, sorted and unique (arch §4.1). */
  contentSignals: readonly string[];
}

export class RobotsChangedError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`robots.txt changed: ${reasons.join("; ")}`);
    this.name = "RobotsChangedError";
  }
}

/** `search=yes, ai-train=no` → `ai-train=no,search=yes`. */
export function normalizeContentSignal(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

export function readContentSignals(text: string): string[] {
  const signals = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*content-signal\s*:([^#]*)/i.exec(line);
    const value = normalizeContentSignal(match?.[1] ?? "");
    if (value) {
      signals.add(value);
    }
  }
  return [...signals].sort();
}

export function parseRobots(robotsUrl: string, text: string, userAgent: string): RobotsPolicy {
  const robots = robotsParser(robotsUrl, text);
  return {
    isAllowed: (url) => robots.isAllowed(url, userAgent) === true,
    crawlDelayMs: (robots.getCrawlDelay(userAgent) ?? 0) * 1000,
    contentSignals: readContentSignals(text),
  };
}

export interface PreflightOptions {
  /** Every reviewed Content-Signal set; the page's set must equal one of them. */
  acceptedSignals: readonly (readonly string[])[];
  plannedUrls: readonly string[];
}

/** Step 1 of the pipeline (arch §6.1): planned paths allowed and Content-Signal a reviewed set. */
export function checkRobots(policy: RobotsPolicy, options: PreflightOptions): void {
  const reasons: string[] = [];
  for (const url of options.plannedUrls) {
    if (!policy.isAllowed(url)) {
      reasons.push(`${url} is disallowed`);
    }
  }
  const accepted = options.acceptedSignals.map((set) =>
    [...new Set(set.map(normalizeContentSignal).filter(Boolean))].sort(),
  );
  const actual = policy.contentSignals.join("\n");
  if (!accepted.some((set) => set.join("\n") === actual)) {
    reasons.push(
      `Content-Signal is ${JSON.stringify(policy.contentSignals)}, expected one of ${JSON.stringify(accepted)}`,
    );
  }
  if (reasons.length > 0) {
    throw new RobotsChangedError(reasons);
  }
}
