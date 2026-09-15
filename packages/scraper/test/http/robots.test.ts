import { describe, expect, it } from "vitest";
import {
  checkRobots,
  normalizeContentSignal,
  parseRobots,
  RobotsChangedError,
  readContentSignals,
} from "../../src/http/robots.ts";

const UA = "helldivers2-api-scraper (+https://github.com/DionathaGoulart/Helldivers-api)";
const ROBOTS = [
  "User-agent: GPTBot",
  "Disallow: /",
  "",
  "User-agent: *",
  "Content-Signal: search=yes, ai-train=no, use=reference",
  "Allow: /",
  "Disallow: /index.php",
  "Disallow: /api.php",
  "Disallow: /wiki/File:",
  "Disallow: /*?action=",
  "Crawl-delay: 5",
].join("\n");

describe("robots", () => {
  const policy = parseRobots("https://helldivers.wiki.gg/robots.txt", ROBOTS, UA);

  it("applies the * group to our user agent", () => {
    expect(policy.isAllowed("https://helldivers.wiki.gg/wiki/Boosters")).toBe(true);
    expect(policy.isAllowed("https://helldivers.wiki.gg/api.php")).toBe(false);
    expect(policy.isAllowed("https://helldivers.wiki.gg/wiki/File:Icon.svg")).toBe(false);
    expect(policy.isAllowed("https://helldivers.wiki.gg/wiki/Boosters?action=raw")).toBe(false);
    expect(policy.isAllowed("https://example.com/wiki/Boosters")).toBe(false);
    expect(policy.crawlDelayMs).toBe(5_000);
  });

  it("normalizes Content-Signal values", () => {
    expect(normalizeContentSignal(" search=yes, AI-train=no ")).toBe("ai-train=no,search=yes");
    expect(
      readContentSignals(`${ROBOTS}\ncontent-signal: use=reference,search=yes,ai-train=no`),
    ).toEqual(["ai-train=no,search=yes,use=reference"]);
  });

  it("passes the preflight when paths are allowed and the signal is unchanged", () => {
    expect(() =>
      checkRobots(policy, {
        expectedSignals: ["search=yes,ai-train=no,use=reference"],
        plannedUrls: ["https://helldivers.wiki.gg/wiki/Boosters"],
      }),
    ).not.toThrow();
  });

  it("fails the preflight on a disallowed path or a changed signal", () => {
    const run = () =>
      checkRobots(policy, {
        expectedSignals: ["search=yes,ai-train=yes,use=reference"],
        plannedUrls: ["https://helldivers.wiki.gg/index.php"],
      });
    expect(run).toThrow(RobotsChangedError);
    expect(run).toThrow(/index\.php is disallowed; Content-Signal is/);
  });
});
