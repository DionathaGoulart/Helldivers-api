import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.ts";

describe("@hd2/schemas", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@hd2/schemas");
  });
});
