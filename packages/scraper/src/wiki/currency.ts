import type { Currency } from "@hd2/schemas";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { textOf } from "./html.ts";

/** Currency from the icon inside a cost cell, never from the column name (arch §4.2, §4.5). */
export function detectCurrency(cell: Cheerio<AnyNode>): Currency | null {
  if (cell.find(".Medalicon, img[src*='/Medal.svg']").length > 0) {
    return "medals";
  }
  if (cell.find("img[src*='Super_Credit']").length > 0) {
    return "super_credits";
  }
  if (cell.find("span.explain[title='USD']").length > 0) {
    return "usd";
  }
  // `4000 Requisition Slips`, or the slip icon alone (Cosmetics weapon patterns).
  if (
    /\brequisition slips?\b/i.test(textOf(cell)) ||
    cell.find("img[src*='/Requisition_Slip.svg']").length > 0
  ) {
    return "requisition";
  }
  return null;
}
