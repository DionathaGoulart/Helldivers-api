import { z } from "zod";
import { collectionSchemas, entityNames } from "./collections.ts";
import { Collection } from "./common.ts";
import { ChangelogEntry, DatasetManifest, Meta, Problem } from "./envelope.ts";

const SCHEMA_BASE_URL = "https://helldivers-api.dionatha.com.br/v1/schemas";

const byName = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * JSON Schema files served at `/v1/schemas/<name>.json`, keyed by file name.
 * Exported in input mode so objects stay open (no `additionalProperties: false`):
 * v1 only adds fields (arch §8.5) and must not break clients that validate.
 */
export function jsonSchemaFiles(): Map<string, string> {
  const schemas: [string, z.ZodType][] = [
    ...Collection.options.map((c): [string, z.ZodType] => [entityNames[c], collectionSchemas[c]]),
    ["changelog-entry", ChangelogEntry],
    ["dataset-manifest", DatasetManifest],
    ["meta", Meta],
    ["problem", Problem],
  ];
  const files = schemas.map(([name, schema]): [string, string] => {
    const { $schema, ...rest } = z.toJSONSchema(schema, { io: "input" });
    const document = { $schema, $id: `${SCHEMA_BASE_URL}/${name}.json`, title: name, ...rest };
    return [`${name}.json`, `${JSON.stringify(document, null, 2)}\n`];
  });
  return new Map(files.sort(byName));
}
