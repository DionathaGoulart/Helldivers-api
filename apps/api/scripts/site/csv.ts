import { type Collection, collectionSchemas } from "@hd2/schemas";
import { z } from "zod";

// `/v1/<collection>.csv` (prd FR-23): one row per entity, columns derived from the zod schema so
// they only change with the schema. Nested objects become dotted columns (`firearm.capacity`),
// scalar arrays are `;`-joined, arrays of objects and records (`attacks`, `statsRaw`) are JSON.

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: unknown[];
};

type ColumnKind = "value" | "join" | "json";

export interface Column {
  path: readonly string[];
  kind: ColumnKind;
}

const SCALAR_TYPES = new Set(["string", "number", "integer", "boolean", "null"]);

const isScalar = (schema: JsonSchema): boolean =>
  schema.enum !== undefined ||
  (typeof schema.type === "string" && SCALAR_TYPES.has(schema.type)) ||
  (Array.isArray(schema.type) && schema.type.every((type) => SCALAR_TYPES.has(type))) ||
  (schema.anyOf?.every(isScalar) ?? false);

function columnsOf(schema: JsonSchema, path: readonly string[]): Column[] {
  // `X | null` flattens like X.
  const variants = schema.anyOf?.filter((variant) => variant.type !== "null");
  if (variants?.length === 1 && variants[0]) {
    return columnsOf(variants[0], path);
  }
  if (schema.type === "object" && schema.properties) {
    return Object.entries(schema.properties).flatMap(([key, child]) =>
      columnsOf(child, [...path, key]),
    );
  }
  if (isScalar(schema)) return [{ path, kind: "value" }];
  if (schema.type === "array" && schema.items && isScalar(schema.items)) {
    return [{ path, kind: "join" }];
  }
  return [{ path, kind: "json" }];
}

export function csvColumns(collection: Collection): Column[] {
  const schema = z.toJSONSchema(collectionSchemas[collection], { io: "input" }) as JsonSchema;
  return columnsOf(schema, []);
}

/** Text that a spreadsheet would run as a formula gets a leading `'` (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown, kind: ColumnKind): string {
  let text: string;
  if (value === null || value === undefined) return "";
  if (kind === "json") {
    text = JSON.stringify(value);
  } else if (kind === "join") {
    text = (value as unknown[]).map((item) => (item === null ? "" : String(item))).join(";");
  } else if (typeof value === "string") {
    text = value;
  } else {
    return String(value); // numbers and booleans are never formulas
  }
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const valueAt = (entity: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    entity,
  );

/** RFC 4180: comma separated, CRLF line ends, header row of dotted paths. */
export function renderCsv(collection: Collection, entities: readonly unknown[]): string {
  const columns = csvColumns(collection);
  const lines = [
    columns.map((column) => column.path.join(".")).join(","),
    ...entities.map((entity) =>
      columns.map((column) => cell(valueAt(entity, column.path), column.kind)).join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
