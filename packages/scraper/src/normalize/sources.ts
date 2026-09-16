import type { Id, SourceType } from "@hd2/schemas";
import { NormalizeError } from "../errors.ts";
import type { RawLink } from "../parsers/raw.ts";
import {
  normalizeWarbondLabel,
  pageFromAnchor,
  type WarbondResolver,
  warbondIdFromTitle,
} from "./warbonds.ts";

// Item page `Source` cells (arch §4.5, §5.5 rule 3): a link to a warbond page, a label from
// `data/overrides/source-labels.json`, or a warbond alias. Anything else fails the run.

export interface RawSourceCell {
  label: string; // "Python Commandos P1", "Starter Equipment"
  link: RawLink | null;
  pageMarker: string | null; // `small .explain[title]`, "Page 1"
}

export type SourceKind =
  | { type: "warbond"; warbondId: Id; page: number | null } // page null: look it up (rule 3)
  | { type: Exclude<SourceType, "warbond">; warbondId: null; page: null };

/** `Page 3` → 3. */
export function pageFromMarker(marker: string | null): number | null {
  const page = /^Page (\d+)$/.exec(marker ?? "")?.[1];
  return page ? Number(page) : null;
}

export function classifySource(
  cell: RawSourceCell,
  options: {
    warbonds: WarbondResolver;
    sourceLabels: Readonly<Record<string, SourceType>>;
    page: string;
  },
): SourceKind {
  const { warbonds, sourceLabels, page } = options;
  const warbondLink = cell.link && warbondIdFromTitle(cell.link.title) ? cell.link : null;
  if (warbondLink) {
    return {
      type: "warbond",
      warbondId: warbonds.resolve(warbondLink, cell.label, page),
      page: pageFromMarker(cell.pageMarker) ?? pageFromAnchor(warbondLink.anchor),
    };
  }

  const label = normalizeWarbondLabel(cell.label);
  const type = Object.entries(sourceLabels).find(
    ([known]) => normalizeWarbondLabel(known) === label,
  )?.[1];
  if (type === "warbond") {
    throw new NormalizeError(page, cell.label, "source-labels.json cannot map a label to warbond");
  }
  if (type) {
    return { type, warbondId: null, page: null };
  }
  try {
    return {
      type: "warbond",
      warbondId: warbonds.resolve(null, cell.label, page),
      page: pageFromMarker(cell.pageMarker),
    };
  } catch {
    throw new NormalizeError(
      page,
      cell.label,
      "unknown source; map it in data/overrides/source-labels.json (or warbond-aliases.json for a warbond)",
    );
  }
}
