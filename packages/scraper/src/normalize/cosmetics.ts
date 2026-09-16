import { NormalizeError } from "../errors.ts";
import { parseNumber } from "./numbers.ts";

// Cosmetics index cells (arch §4.5): emote flags and level columns.

const FLAGS: Readonly<Record<string, boolean>> = { "✅": true, "❌": false };

/** `✅` → true, `❌` → false (Cosmetics "Emote" / "Victory Pose" columns). */
export function parseFlag(text: string, page: string): boolean {
  const flag = FLAGS[text.trim()];
  if (flag === undefined) {
    throw new NormalizeError(page, text, "expected ✅ or ❌");
  }
  return flag;
}

/** `10`, `0` → a non-negative whole level ("Level Earned", "Level Needed"). */
export function parseLevel(text: string, page: string): number {
  const level = parseNumber(text, page);
  if (!Number.isInteger(level) || level < 0) {
    throw new NormalizeError(page, text, "expected a whole level");
  }
  return level;
}
