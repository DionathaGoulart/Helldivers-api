import { describe, expect, it } from "vitest";
import { renderHeaders } from "../scripts/headers.ts";

describe("renderHeaders", () => {
  it("applies CORS and nosniff to every path", () => {
    const headers = renderHeaders();

    expect(headers.startsWith("/*\n")).toBe(true);
    expect(headers).toContain("  Access-Control-Allow-Origin: *\n");
    expect(headers).toContain("  X-Content-Type-Options: nosniff\n");
  });
});
