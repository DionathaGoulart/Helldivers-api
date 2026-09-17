import type { z } from "zod";
import { collectionSchemas } from "./collections.ts";
import { Collection } from "./common.ts";
import { ChangelogEntry, DatasetManifest, Item, List, type Meta } from "./envelope.ts";
import { checkIntegrity, type Dataset } from "./integrity.ts";
import { jsonSchemaFiles } from "./json-schema.ts";
import { ConflictReport, ImageManifest } from "./reports.ts";

// Validates a `data/v1` tree held in memory (relative POSIX path → parsed JSON):
//   meta.json · changelog.json · <collection>.json · <collection>/<id>.json
//   schemas/<entity>.json (optional, must match the zod export) · reports/*.json
// Facets, CSV and the search index are build outputs (Phase 5) and never live here.

export interface DatasetIssue {
  file: string; // relative to the dataset root
  path: string; // "data.weight", "" for the whole file
  message: string;
}

const MAX_CHANGELOG_ENTRIES = 90;
const REPORT_FILES = new Set(["images.json", "conflicts.json", "sources.json"]);

type Segment = PropertyKey;

export function formatPath(segments: readonly Segment[]): string {
  return segments
    .map((segment, i) => {
      if (typeof segment === "number") return `[${segment}]`;
      const key = String(segment);
      if (/^[A-Za-z_$][\w$]*$/.test(key)) return i === 0 ? key : `.${key}`;
      return `[${JSON.stringify(key)}]`;
    })
    .join("");
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * zod drops unknown keys and emits keys in schema order, so any difference between
 * the raw JSON and the parsed value is an unknown key or a key out of order (arch §5.1).
 */
function keyMismatch(raw: unknown, parsed: unknown, path: Segment[]): DatasetIssue | null {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    for (const [i, item] of raw.entries()) {
      const found = keyMismatch(item, parsed[i], [...path, i]);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(raw) || !isPlainObject(parsed)) {
    return null;
  }
  const rawKeys = Object.keys(raw);
  const parsedKeys = Object.keys(parsed);
  const unknown = rawKeys.find((key) => !(key in parsed));
  if (unknown !== undefined) {
    return { file: "", path: formatPath([...path, unknown]), message: "unknown key" };
  }
  if (rawKeys.join("\0") !== parsedKeys.join("\0")) {
    return {
      file: "",
      path: formatPath(path),
      message: `keys out of schema order: expected ${parsedKeys.join(", ")}`,
    };
  }
  for (const key of rawKeys) {
    const found = keyMismatch(raw[key], parsed[key], [...path, key]);
    if (found) return found;
  }
  return null;
}

export function validateDataset(files: ReadonlyMap<string, unknown>): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const add = (file: string, path: string, message: string) => {
    issues.push({ file, path, message });
  };

  const parse = <T extends z.ZodType>(file: string, schema: T): z.infer<T> | undefined => {
    const raw = files.get(file);
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        add(file, formatPath(issue.path), issue.message);
      }
      return undefined;
    }
    const mismatch = keyMismatch(raw, result.data, []);
    if (mismatch) {
      add(file, mismatch.path, mismatch.message);
    }
    return result.data;
  };

  // Classify every file; anything else is a stray file.
  const itemFiles = new Map<Collection, string[]>();
  const schemaFiles: string[] = [];
  for (const file of [...files.keys()].sort()) {
    const parts = file.split("/");
    const [first = "", second] = parts;
    if (parts.length === 1 && ["meta.json", "changelog.json"].includes(first)) continue;
    if (parts.length === 1 && Collection.safeParse(first.replace(/\.json$/, "")).success) continue;
    if (parts.length === 2 && second?.endsWith(".json")) {
      const collection = Collection.safeParse(first);
      if (collection.success) {
        itemFiles.set(collection.data, [...(itemFiles.get(collection.data) ?? []), file]);
        continue;
      }
      if (first === "schemas") {
        schemaFiles.push(file);
        continue;
      }
      if (first === "reports" && REPORT_FILES.has(second)) continue;
    }
    add(file, "", "unexpected file");
  }

  // meta.json anchors dataVersion and generatedAt for every envelope.
  if (!files.has("meta.json")) {
    add("meta.json", "", "missing file");
    return issues;
  }
  const manifest = parse("meta.json", DatasetManifest);
  if (!manifest) {
    return issues;
  }
  const checkMeta = (file: string, meta: Meta) => {
    if (meta.dataVersion !== manifest.dataVersion) {
      add(file, "meta.dataVersion", `expected ${manifest.dataVersion} (meta.json)`);
    }
    if (meta.generatedAt !== manifest.generatedAt) {
      add(file, "meta.generatedAt", `expected ${manifest.generatedAt} (meta.json)`);
    }
  };

  // changelog.json: newest first, at most 90 entries, head describes this dataVersion.
  if (!files.has("changelog.json")) {
    add("changelog.json", "", "missing file");
  } else {
    const changelog = parse("changelog.json", List(ChangelogEntry));
    if (changelog) {
      checkMeta("changelog.json", changelog.meta);
      if (changelog.data.length > MAX_CHANGELOG_ENTRIES) {
        add("changelog.json", "data", `at most ${MAX_CHANGELOG_ENTRIES} entries`);
      }
      changelog.data.forEach((entry, i) => {
        const previous = changelog.data[i - 1];
        if (previous && previous.date < entry.date) {
          add("changelog.json", `data[${i}].date`, "entries must be newest first");
        }
      });
      const head = changelog.data[0];
      if (head && head.dataVersion !== manifest.dataVersion) {
        add(
          "changelog.json",
          "data[0].dataVersion",
          `expected ${manifest.dataVersion} (meta.json)`,
        );
      }
    }
  }

  // Collections: list file, one item file per entity, counts and ordering.
  const dataset: Dataset = {};
  let entitiesValid = true;
  for (const collection of Collection.options) {
    const listFile = `${collection}.json`;
    const items = itemFiles.get(collection) ?? [];
    const counted = manifest.collections[collection];
    if (!files.has(listFile)) {
      if (counted) add("meta.json", `collections["${collection}"]`, `${listFile} is missing`);
      for (const file of items) add(file, "", `${listFile} is missing`);
      continue;
    }
    if (!counted) {
      add(listFile, "", "collection missing from meta.json");
    }

    const schema = collectionSchemas[collection];
    const list = parse(listFile, List(schema));
    if (!list) {
      entitiesValid = false;
      for (const file of items) parse(file, Item(schema));
      continue;
    }
    checkMeta(listFile, list.meta);
    const ids = list.data.map((entity) => entity.id);
    if (list.meta.count !== ids.length) {
      add(listFile, "meta.count", `expected ${ids.length}`);
    }
    if (counted && counted.count !== ids.length) {
      add("meta.json", `collections["${collection}"].count`, `expected ${ids.length}`);
    }
    ids.forEach((id, i) => {
      const previous = ids[i - 1];
      if (previous !== undefined && previous >= id) {
        add(listFile, `data[${i}].id`, "list must be sorted by id, without duplicates");
      }
    });

    const rawList = files.get(listFile) as { data: unknown[] };
    const rawById = new Map(ids.map((id, i) => [id, rawList.data[i]]));
    for (const file of items) {
      const fileId = file.slice(collection.length + 1, -".json".length);
      const item = parse(file, Item(schema));
      if (!item) {
        entitiesValid = false;
        continue;
      }
      checkMeta(file, item.meta);
      if (item.data.id !== fileId) {
        add(file, "data.id", `expected ${fileId} (file name)`);
      }
      const rawEntity = rawById.get(fileId);
      if (rawEntity === undefined) {
        add(file, "", `not listed in ${listFile}`);
      } else if (
        JSON.stringify((files.get(file) as { data: unknown }).data) !== JSON.stringify(rawEntity)
      ) {
        add(file, "data", `differs from its entry in ${listFile}`);
      }
    }
    const itemIds = new Set(
      items.map((file) => file.slice(collection.length + 1, -".json".length)),
    );
    ids.forEach((id, i) => {
      if (!itemIds.has(id)) add(listFile, `data[${i}]`, `${collection}/${id}.json is missing`);
    });

    (dataset as Record<Collection, unknown>)[collection] = list.data;
  }

  // Generated JSON Schema files must match the current zod schemas.
  if (schemaFiles.length > 0) {
    for (const [name, text] of jsonSchemaFiles()) {
      const file = `schemas/${name}`;
      if (!files.has(file)) {
        add(file, "", "missing file");
      } else if (JSON.stringify(files.get(file)) !== JSON.stringify(JSON.parse(text))) {
        add(file, "", "out of date: run pnpm schemas:export");
      }
    }
    for (const file of schemaFiles) {
      if (!jsonSchemaFiles().has(file.slice("schemas/".length))) add(file, "", "unexpected file");
    }
  }

  // Integrity runs only on schema-valid entities, so it never reports noise.
  let images: ImageManifest | undefined;
  if (files.has("reports/images.json")) {
    images = parse("reports/images.json", ImageManifest);
    const sorted = (list: readonly { url: string }[], path: string) => {
      list.forEach(({ url }, i) => {
        const previous = list[i - 1];
        if (previous && previous.url >= url) {
          add("reports/images.json", `${path}[${i}].url`, "sort by url, without duplicates");
        }
      });
    };
    sorted(images?.images ?? [], "images");
    sorted(images?.orphans ?? [], "orphans");
    const live = new Set(images?.images.map((image) => image.url));
    images?.orphans.forEach(({ url }, i) => {
      if (live.has(url)) add("reports/images.json", `orphans[${i}].url`, "also listed in images");
    });
  }
  // Conflicts name existing entities, in a stable order.
  if (files.has("reports/conflicts.json")) {
    const report = parse("reports/conflicts.json", ConflictReport);
    const key = (c: { collection: string; id: string; field: string }) =>
      `${c.collection}\0${c.id}\0${c.field}`;
    report?.conflicts.forEach((conflict, i) => {
      const previous = report.conflicts[i - 1];
      if (previous && key(previous) > key(conflict)) {
        add("reports/conflicts.json", `conflicts[${i}]`, "sort by collection, id and field");
      }
      const list = dataset[conflict.collection];
      if (entitiesValid && list && !list.some((entity) => entity.id === conflict.id)) {
        add(
          "reports/conflicts.json",
          `conflicts[${i}].id`,
          `${conflict.collection}/${conflict.id} does not exist`,
        );
      }
    });
  }
  if (entitiesValid) {
    const referenced = new Set(
      [...JSON.stringify(Object.values(dataset)).matchAll(/"url":"(\/images\/[^"]+)"/g)].map(
        (match) => match[1],
      ),
    );
    if (referenced.size > 0 && !images) {
      add("reports/images.json", "", "missing file: entities reference images");
    }
    images?.images.forEach(({ url }, i) => {
      if (!referenced.has(url)) {
        add(
          "reports/images.json",
          `images[${i}].url`,
          "no entity references it: list it in orphans",
        );
      }
    });
    const integrity = checkIntegrity(
      dataset,
      images ? { images: new Map(images.images.map((image) => [image.url, image])) } : {},
    );
    for (const issue of integrity) {
      add(`${issue.collection}/${issue.id}.json`, `data.${issue.field}`, issue.message);
    }
  }

  return issues;
}
