import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { ParseError } from "../errors.ts";
import { textOf } from "./html.ts";

export interface WikitableRow {
  section: string | null; // text of the last all-`th` row above (`Attacks`, `Damage`)
  cells: Cheerio<Element>[];
}

export interface Wikitable {
  headers: string[];
  rows: WikitableRow[];
}

/**
 * `table.wikitable` → header texts + data rows (arch §4.2). The first all-`th` row is
 * the header; later all-`th` rows are section rows. Rows of nested tables are skipped.
 */
export function readWikitable($: CheerioAPI, table: Cheerio<Element>): Wikitable {
  const tableNode = table.get(0);
  let headers: string[] | null = null;
  let section: string | null = null;
  const rows: WikitableRow[] = [];

  for (const tr of table.find("tr").toArray()) {
    if ($(tr).closest("table").get(0) !== tableNode) {
      continue;
    }
    const cells = $(tr)
      .children("th, td")
      .toArray()
      .map((cell) => $(cell));
    if (cells.length === 0) {
      continue;
    }
    const onlyHeaders = cells.every((cell) => cell.is("th"));
    if (onlyHeaders && headers === null) {
      headers = cells.map((cell) => textOf(cell));
    } else if (onlyHeaders) {
      section = cells.map((cell) => textOf(cell)).join(" ") || null;
    } else {
      headers ??= [];
      rows.push({ section, cells });
    }
  }
  return { headers: headers ?? [], rows };
}

/** Index of each named column; a missing column means the page layout changed. */
export function columnIndexes<const Name extends string>(
  table: Wikitable,
  names: readonly Name[],
  page: string,
  selector: string,
): Record<Name, number> {
  const indexes = {} as Record<Name, number>;
  for (const name of names) {
    const index = table.headers.indexOf(name);
    if (index === -1) {
      throw new ParseError(
        page,
        selector,
        `missing column "${name}", found ${JSON.stringify(table.headers)}`,
      );
    }
    indexes[name] = index;
  }
  return indexes;
}

/** The row with each cell repeated `colspan` times, so cells line up with the headers. */
export function expandColspans(row: WikitableRow): WikitableRow {
  return {
    ...row,
    cells: row.cells.flatMap((cell) =>
      Array.from(
        { length: Math.max(1, Number.parseInt(cell.attr("colspan") ?? "1", 10) || 1) },
        () => cell,
      ),
    ),
  };
}

export function cellAt(
  row: WikitableRow,
  index: number,
  page: string,
  selector: string,
): Cheerio<Element> {
  const cell = row.cells[index];
  if (!cell) {
    throw new ParseError(page, selector, `row has ${row.cells.length} cells, needs ${index + 1}`);
  }
  return cell;
}
