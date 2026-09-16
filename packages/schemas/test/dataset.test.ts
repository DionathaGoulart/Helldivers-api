import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatPath, validateDataset } from "../src/dataset.ts";
import { jsonSchemaFiles } from "../src/json-schema.ts";
import { readDatasetFiles } from "../src/node.ts";
import { mutate, type PathSegment } from "./helpers.ts";

const datasetDir = join(import.meta.dirname, "dataset");
const repoDir = join(import.meta.dirname, "..", "..", "..");

let pristine: Map<string, unknown>;

beforeAll(async () => {
  const { files, issues } = await readDatasetFiles(datasetDir);
  expect(issues).toEqual([]);
  pristine = files;
});

const load = () => structuredClone(pristine);

function edit(files: Map<string, unknown>, file: string, path: PathSegment[], next: unknown) {
  files.set(file, mutate(files.get(file), path, next));
}

const INVALID_WEIGHT = 'Invalid option: expected one of "light"|"medium"|"heavy"';

describe("validateDataset", () => {
  it("accepts the synthetic dataset", () => {
    expect(validateDataset(load())).toEqual([]);
  });

  it("reports schema issues with file and path", () => {
    const files = load();
    edit(files, "armors.json", ["data", 1, "weight"], "ultra");
    edit(files, "armors/tg-8-sharpshooter.json", ["data", "weight"], "ultra");

    expect(validateDataset(files)).toEqual([
      { file: "armors.json", path: "data[1].weight", message: INVALID_WEIGHT },
      { file: "armors/tg-8-sharpshooter.json", path: "data.weight", message: INVALID_WEIGHT },
    ]);
  });

  it("requires meta.json", () => {
    const files = load();
    files.delete("meta.json");

    expect(validateDataset(files)).toEqual([
      { file: "meta.json", path: "", message: "missing file" },
    ]);
  });

  it("reports stray files and missing item files", () => {
    const files = load();
    files.delete("boosters/hellpod-space-optimization.json");
    files.set("boosters/by-warbond/helldivers-mobilize.json", {});
    files.set("notes.json", {});

    expect(validateDataset(files)).toEqual([
      {
        file: "boosters/by-warbond/helldivers-mobilize.json",
        path: "",
        message: "unexpected file",
      },
      { file: "notes.json", path: "", message: "unexpected file" },
      {
        file: "boosters.json",
        path: "data[0]",
        message: "boosters/hellpod-space-optimization.json is missing",
      },
    ]);
  });

  it("requires each item file to equal its list entry", () => {
    const files = load();
    edit(files, "armors/tg-8-sharpshooter.json", ["data", "description"], null);

    expect(validateDataset(files)).toEqual([
      {
        file: "armors/tg-8-sharpshooter.json",
        path: "data",
        message: "differs from its entry in armors.json",
      },
    ]);
  });

  it("requires every envelope to carry the dataset version", () => {
    const files = load();
    edit(files, "weapons.json", ["meta", "dataVersion"], "2026-09-16.0d15ea5e");

    expect(validateDataset(files)).toEqual([
      {
        file: "weapons.json",
        path: "meta.dataVersion",
        message: "expected 2026-09-15.0d15ea5e (meta.json)",
      },
    ]);
  });

  it("checks counts in list files and meta.json", () => {
    const files = load();
    edit(files, "boosters.json", ["meta", "count"], 2);
    edit(files, "meta.json", ["collections", "titles", "count"], 4);

    expect(validateDataset(files)).toEqual([
      { file: "boosters.json", path: "meta.count", message: "expected 1" },
      { file: "meta.json", path: 'collections["titles"].count', message: "expected 3" },
    ]);
  });

  it("requires lists sorted by id", () => {
    const files = load();
    const list = files.get("weapons.json") as { data: unknown[] };
    const [first, second, ...rest] = list.data;
    edit(files, "weapons.json", ["data"], [second, first, ...rest]);

    expect(validateDataset(files)).toEqual([
      {
        file: "weapons.json",
        path: "data[1].id",
        message: "list must be sorted by id, without duplicates",
      },
    ]);
  });

  it("rejects unknown keys", () => {
    const files = load();
    edit(files, "weapons/ar-23-liberator.json", ["data", "rarity"], "common");

    expect(validateDataset(files)).toEqual([
      { file: "weapons/ar-23-liberator.json", path: "data.rarity", message: "unknown key" },
      {
        file: "weapons/ar-23-liberator.json",
        path: "data",
        message: "differs from its entry in weapons.json",
      },
    ]);
  });

  it("requires keys in schema order", () => {
    const files = load();
    const item = files.get("boosters/hellpod-space-optimization.json") as {
      data: Record<string, unknown>;
    };
    const { id, slug, name, ...rest } = item.data;
    const reordered = { id, name, slug, ...rest };
    edit(files, "boosters.json", ["data", 0], reordered);
    edit(files, "boosters/hellpod-space-optimization.json", ["data"], reordered);

    const message =
      "keys out of schema order: expected id, slug, name, aliases, description, image, wiki, effect, source";
    expect(validateDataset(files)).toEqual([
      { file: "boosters.json", path: "data[0]", message },
      { file: "boosters/hellpod-space-optimization.json", path: "data", message },
    ]);
  });

  it("maps integrity issues to item files", () => {
    const files = load();
    edit(files, "armors.json", ["data", 1, "passiveId"], "iron-lungs");
    edit(files, "armors/tg-8-sharpshooter.json", ["data", "passiveId"], "iron-lungs");

    expect(validateDataset(files)).toEqual([
      {
        file: "armors/tg-8-sharpshooter.json",
        path: "data.passiveId",
        message: "passives/iron-lungs does not exist",
      },
      {
        file: "passives/true-grit.json",
        path: "data.armorIds",
        message: "lists armors/tg-8-sharpshooter, which does not reference passives/true-grit",
      },
    ]);
  });

  it("requires the image manifest when entities have images", () => {
    const files = load();
    files.delete("reports/images.json");

    expect(validateDataset(files)).toEqual([
      { file: "reports/images.json", path: "", message: "missing file: entities reference images" },
    ]);
  });

  it("checks that conflicts name existing entities in a stable order", () => {
    const files = load();
    const [conflict] = (files.get("reports/conflicts.json") as { conflicts: unknown[] }).conflicts;
    edit(
      files,
      "reports/conflicts.json",
      ["conflicts"],
      [
        conflict,
        mutate(conflict, ["id"], "ar-99-missing"),
        mutate(conflict, ["field"], "firearm.capacity"),
      ],
    );

    expect(validateDataset(files)).toEqual([
      {
        file: "reports/conflicts.json",
        path: "conflicts[1].id",
        message: "weapons/ar-99-missing does not exist",
      },
      {
        file: "reports/conflicts.json",
        path: "conflicts[2]",
        message: "sort by collection, id and field",
      },
    ]);
  });

  it("requires the newest changelog entry to describe this dataset", () => {
    const files = load();
    edit(files, "changelog.json", ["data", 0, "dataVersion"], "2026-09-14.0d15ea5e");

    expect(validateDataset(files)).toEqual([
      {
        file: "changelog.json",
        path: "data[0].dataVersion",
        message: "expected 2026-09-15.0d15ea5e (meta.json)",
      },
    ]);
  });

  it("checks exported JSON Schema files against the zod schemas", () => {
    const files = load();
    for (const [name, text] of jsonSchemaFiles()) {
      files.set(`schemas/${name}`, JSON.parse(text));
    }
    expect(validateDataset(files)).toEqual([]);

    edit(files, "schemas/booster.json", ["title"], "Booster");
    files.set("schemas/enemy.json", {});
    expect(validateDataset(files)).toEqual([
      { file: "schemas/booster.json", path: "", message: "out of date: run pnpm schemas:export" },
      { file: "schemas/enemy.json", path: "", message: "unexpected file" },
    ]);
  });

  it("formats zod paths", () => {
    expect(formatPath(["data", 0, "statsRaw", "Weapon Category"])).toBe(
      'data[0].statsRaw["Weapon Category"]',
    );
  });
});

describe("pnpm validate:data", () => {
  const run = promisify(execFile);
  const script = join(repoDir, "packages", "schemas", "scripts", "validate-data.ts");
  let workDir = "";

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("passes on the synthetic dataset and fails on a hand-broken copy", {
    timeout: 30_000,
  }, async () => {
    workDir = await mkdtemp(join(tmpdir(), "hd2-validate-"));
    await cp(datasetDir, join(workDir, "dataset"), { recursive: true });
    const options = { cwd: repoDir, env: { ...process.env, INIT_CWD: workDir } };
    const tsx = join(repoDir, "node_modules", ".bin", "tsx");

    const ok = await run(tsx, [script, "dataset"], options);
    expect(ok.stdout).toMatch(/^validate:data ok · 55 files · dataset$/m);

    const itemPath = join(workDir, "dataset", "armors", "tg-8-sharpshooter.json");
    const item = await readFile(itemPath, "utf8");
    await writeFile(itemPath, item.replace('"weight": "medium"', '"weight": "ultra"'));

    const failed = await run(tsx, [script, "dataset"], options).then(
      () => null,
      (error: { code: number; stderr: string }) => error,
    );
    expect(failed?.code).toBe(1);
    expect(failed?.stderr).toContain(
      `dataset/armors/tg-8-sharpshooter.json: data.weight: ${INVALID_WEIGHT}`,
    );
  });
});
