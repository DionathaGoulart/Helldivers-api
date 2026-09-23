import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Id, SourceType } from "@hd2/schemas";
import { z } from "zod";

// `data/overrides/*.json`: hand-maintained scraper inputs (see data/overrides/README.md).

export const WarbondAliases = z.record(z.string().min(1), Id);
export const SourceLabels = z.record(z.string().min(1), SourceType);
/** Misspelled trait heading id on the Equipment Traits page → the trait it stands for. */
export const TraitAliases = z.record(z.string().min(1), Id);
/** Armor set id → its cape (null: no cape, whatever the evidence says) and why (rule 6). */
export const ArmorSetOverrides = z.record(
  Id,
  z.strictObject({ capeId: Id.nullable(), evidence: z.string().min(1) }),
);

export interface Overrides {
  warbondAliases: z.infer<typeof WarbondAliases>;
  sourceLabels: z.infer<typeof SourceLabels>;
  traitAliases: z.infer<typeof TraitAliases>;
  armorSets: z.infer<typeof ArmorSetOverrides>;
}

export const overridesDir = (dataDir: string) => join(dataDir, "overrides");
export const idLockPath = (dataDir: string) => join(overridesDir(dataDir), "ids.lock.json");

async function readOverride<T extends z.ZodType>(
  path: string,
  schema: T,
  missing: z.infer<T>,
): Promise<z.infer<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return missing;
    }
    throw error;
  }
  const result = schema.safeParse(JSON.parse(text));
  if (!result.success) {
    throw new Error(`${path}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export async function readOverrides(dataDir: string): Promise<Overrides> {
  const dir = overridesDir(dataDir);
  return {
    warbondAliases: await readOverride(join(dir, "warbond-aliases.json"), WarbondAliases, {}),
    sourceLabels: await readOverride(join(dir, "source-labels.json"), SourceLabels, {}),
    traitAliases: await readOverride(join(dir, "trait-aliases.json"), TraitAliases, {}),
    armorSets: await readOverride(join(dir, "armor-sets.json"), ArmorSetOverrides, {}),
  };
}
