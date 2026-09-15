import { NormalizeError } from "../errors.ts";

/** `1,140.3` → 1140.3, `050` → 50, `2,015` → 2015 (arch §4.5). */
export function parseNumber(text: string, page: string): number {
  const cleaned = text.replace(/[\s,]/g, "");
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) {
    throw new NormalizeError(page, text, "not a number");
  }
  return Number(cleaned);
}
