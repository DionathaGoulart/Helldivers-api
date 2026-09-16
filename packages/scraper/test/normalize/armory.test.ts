import { describe, expect, it } from "vitest";
import { armoryName } from "../../src/normalize/armory.ts";

describe("armoryName", () => {
  it.each([
    ["CPH-26 Commandant (Armor)", "CPH-26 Commandant"],
    ["Cloak of Posterity's Gratitude (Cape)", "Cloak of Posterity's Gratitude"],
    ["TG-8 Sharpshooter", "TG-8 Sharpshooter"],
    ["Standard (Issue) Cape", "Standard (Issue) Cape"],
  ])("%s → %s", (title, name) => {
    expect(armoryName(title)).toBe(name);
  });
});
