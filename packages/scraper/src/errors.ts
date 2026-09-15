import { z } from "zod";

/** A page no longer matches what its parser expects (alert `parser-broken`, arch §7.1). */
export class ParseError extends Error {
  constructor(
    readonly page: string,
    readonly selector: string,
    readonly hint: string,
  ) {
    super(`${page}: ${selector}: ${hint}`);
    this.name = "ParseError";
  }
}

/** A wiki value the normalizers do not know: unknown label, enum or cost format (arch §6.4). */
export class NormalizeError extends Error {
  constructor(
    readonly page: string,
    readonly value: string,
    readonly hint: string,
  ) {
    super(`${page}: ${JSON.stringify(value)}: ${hint}`);
    this.name = "NormalizeError";
  }
}

/** Parses a raw record, turning a zod failure into a ParseError that names the page. */
export function parseRaw<T extends z.ZodType>(
  schema: T,
  value: unknown,
  page: string,
  selector: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ParseError(page, selector, z.prettifyError(result.error));
  }
  return result.data;
}
