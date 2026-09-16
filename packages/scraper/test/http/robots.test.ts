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

  const accepted = [["search=yes,ai-train=no,use=reference"], []];
  const boosters = ["https://helldivers.wiki.gg/wiki/Boosters"];

  it("passes the preflight when paths are allowed and the signal set was reviewed", () => {
    expect(() =>
      checkRobots(policy, { acceptedSignals: accepted, plannedUrls: boosters }),
    ).not.toThrow();
    // The managed block that carries the signal disappeared on 2026-09-16 (arch §4.1).
    const unsigned = parseRobots(
      "https://helldivers.wiki.gg/robots.txt",
      ROBOTS.replace(/^Content-Signal:.*$/m, ""),
      UA,
    );
    expect(unsigned.contentSignals).toEqual([]);
    expect(() =>
      checkRobots(unsigned, { acceptedSignals: accepted, plannedUrls: boosters }),
    ).not.toThrow();
  });

  it("fails the preflight on a disallowed path or an unreviewed signal", () => {
    const run = () =>
      checkRobots(policy, {
        acceptedSignals: [["search=yes,ai-train=yes,use=reference"], []],
        plannedUrls: ["https://helldivers.wiki.gg/index.php"],
      });
    expect(run).toThrow(RobotsChangedError);
    expect(run).toThrow(/index\.php is disallowed; Content-Signal is/);
    const stricter = parseRobots(
      "https://helldivers.wiki.gg/robots.txt",
      ROBOTS.replace("use=reference", "use=reference, ai-input=no"),
      UA,
    );
    expect(() =>
      checkRobots(stricter, { acceptedSignals: accepted, plannedUrls: boosters }),
    ).toThrow(/Content-Signal is \["ai-input=no,ai-train=no,search=yes,use=reference"\]/);
  });
});
