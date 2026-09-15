import type { Cost, Currency } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import type { RawCost } from "../parsers/raw.ts";
import { parseNumber } from "./numbers.ts";

// arch §4.5 cost formats: `75 Medals`, `4000 Requisition Slips`, `💲20`, `Free`,
// `N/A`, `❌`, `/`, empty. `cost: null` means not purchasable (arch §5.1).

const NO_COST = /^(?:|n\/a|❌|\/|-|—)$/i;
const AMOUNT = /\d[\d,]*(?:\.\d+)?/g;

export interface CostOptions {
  /** Currency when the cell has no icon, e.g. a requisition column that says `Free`. */
  fallbackCurrency?: Currency;
}

export function parseCost(raw: RawCost, page: string, options: CostOptions = {}): Cost | null {
  const text = raw.text.trim();
  if (NO_COST.test(text)) {
    return null;
  }
  const currency = raw.currency ?? options.fallbackCurrency;
  if (!currency) {
    throw new NormalizeError(page, text, "cost without a currency icon");
  }
  if (/^free$/i.test(text)) {
    return { currency, amount: 0 };
  }
  const amounts = text.match(AMOUNT) ?? [];
  if (amounts.length !== 1 || !amounts[0]) {
    throw new NormalizeError(page, text, `expected one amount, found ${amounts.length}`);
  }
  return { currency, amount: parseNumber(amounts[0], page) };
}
