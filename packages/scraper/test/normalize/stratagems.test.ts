import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Department, type Stratagem } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { NormalizeError } from "../../src/errors.ts";
import {
  kindFromCategories,
  leadAbbreviations,
  normalizeStratagemStats,
  parseCode,
  parseDepartment,
  parseUses,
  permitAndAvailability,
} from "../../src/normalize/stratagems.ts";
import { parseStratagemPage } from "../../src/parsers/stratagem-page.ts";
import type { RawStratagemRow } from "../../src/parsers/stratagems-index.ts";
import { loadHtml, textOf } from "../../src/wiki/html.ts";
import { readWikitable } from "../../src/wiki/wikitable.ts";
import { fixture } from "../fixtures.ts";

const PAGE = "https://helldivers.wiki.gg/wiki/Stratagems";

const example = async (id: string) =>
  JSON.parse(
    await readFile(
      join(import.meta.dirname, `../../../schemas/test/examples/stratagems.${id}.json`),
      "utf8",
    ),
  ) as Stratagem;

async function stats(title: string, kind: Stratagem["kind"], traitIds: string[] = []) {
  const page = await fixture(title);
  const raw = parseStratagemPage(page.html, { url: page.url });
  return normalizeStratagemStats(raw, { page: page.url, kind, traitIds });
}

describe("normalizeStratagemStats", () => {
  it("builds the Orbital Precision Strike of arch §5.4", async () => {
    const ops = await example("orbital-precision-strike");
    const result = await stats("Orbital Precision Strike", "orbital");
    expect(result).toMatchObject({
      cooldownS: ops.cooldownS,
      cooldownVariants: ops.cooldownVariants,
      callInTimeS: ops.callInTimeS,
      callInTimeUpgradedS: ops.callInTimeUpgradedS,
      uses: ops.uses,
      supportWeapon: null,
      backpack: null,
      conflicts: [],
    });
    expect(result.attacks.map((attack) => [attack.name, attack.kind])).toEqual(
      ops.attacks.map((attack) => [attack.name, attack.kind]),
    );
    expect(result.attacks[0]?.projectile?.massG).toBe(30000); // `30 kg`
    expect(result.statsRaw).toMatchObject({
      "General › Cooldown › With All Upgrades": "76.95 seconds",
      "Orbital Precision Strike › Bombs": "1",
      "Orbital Precision Strike › Bombardment Area Size": "1 m",
      "Orbital Precision Strike › Uses": "∞",
    });
  });

  it("reads the MG-43 support weapon and logs its supply refill conflict (rule 2)", async () => {
    const mg43 = await example("mg-43-machine-gun");
    const result = await stats("MG-43 Machine Gun", "support_weapon", mg43.traitIds);
    expect(result.supportWeapon).toEqual(mg43.supportWeapon);
    expect(result).toMatchObject({ cooldownS: 480, callInTimeS: 7.75, uses: "unlimited" });
    expect(result.conflicts).toEqual([
      {
        field: "supportWeapon.magazinesFromSupply",
        rule: 2,
        chosen: 2,
        candidates: [
          { location: "infobox › Supply Box Refill", value: 3 },
          { location: "MG-43 MACHINE GUN › Mags from Supply", value: 2 },
        ],
      },
    ]);
  });

  it("prefers the detailed call-in time of the B-1 Supply Pack and logs the conflict", async () => {
    const pack = await stats("B-1 Supply Pack", "backpack");
    expect(pack).toMatchObject({
      callInTimeS: 5,
      backpack: { health: 200, armor: "light", capacity: 4 },
      supportWeapon: null,
    });
    expect(pack.conflicts).toEqual([
      {
        field: "callInTimeS",
        rule: 2,
        chosen: 5,
        candidates: [
          { location: "General › Call-in Time", value: 9.75 },
          { location: "B-1 Supply Pack › Call-in Time", value: 5 },
        ],
      },
    ]);
  });

  it("gives melee support weapons no firearm stats", async () => {
    const hammer = await stats("CQC-20 Breaching Hammer", "support_weapon");
    expect(hammer.supportWeapon).toBeNull();
    expect(hammer.attacks.map((attack) => attack.kind)).toEqual(["melee", "explosion"]);
  });

  it("reads eagle uses, mission placeholders and range forces", async () => {
    expect((await stats("Eagle Airstrike", "eagle")).uses).toBe(2);
    expect(await stats("Reinforce", "mission")).toMatchObject({
      callInTimeS: null,
      uses: "unlimited",
    });
    const breakthrough = await stats("EXO-55 Breakthrough Exosuit", "vehicle");
    expect(breakthrough.attacks.some((attack) => attack.forces.demolition === 30)).toBe(true);
  });
});

describe("stratagem fields", () => {
  const row = (permit: RawStratagemRow["permit"], label: string | null) =>
    ({ permit, label }) as RawStratagemRow;

  it("takes permit and availability from the index tables", () => {
    expect(permitAndAvailability(row("Supply Permit", null), PAGE)).toEqual({
      permitType: "supply",
      availability: "loadout",
    });
    expect(permitAndAvailability(row("Other", "Objective"), PAGE)).toEqual({
      permitType: "mission",
      availability: "objective",
    });
    expect(permitAndAvailability(row("Other", "Unavailable"), PAGE).availability).toBe(
      "unavailable",
    );
    expect(() => permitAndAvailability(row("Other", "Seasonal"), PAGE)).toThrow(
      "unknown mission stratagem table",
    );
  });

  it("takes the kind from one category, or mission for the mission permit", () => {
    expect(
      kindFromCategories(
        ["Stratagems", "Support Weapon Stratagems", "Warbond Stratagems"],
        "supply",
        PAGE,
      ),
    ).toBe("support_weapon");
    expect(kindFromCategories(["Ship Stratagems", "Eagle Stratagems"], "mission", PAGE)).toBe(
      "mission",
    );
    expect(() => kindFromCategories(["Stratagems"], "offensive", PAGE)).toThrow(NormalizeError);
    expect(() =>
      kindFromCategories(["Orbital Stratagems", "Eagle Stratagems"], "offensive", PAGE),
    ).toThrow("found 2");
  });

  it("parses codes, uses, departments and lead abbreviations", () => {
    expect(parseCode(["Right", "Right", "Up"], PAGE)).toEqual(["right", "right", "up"]);
    expect(() => parseCode(["Sideways"], PAGE)).toThrow("unknown stratagem code arrow");
    expect(parseUses("Unlimited", PAGE)).toBe("unlimited");
    expect(parseUses("INF", PAGE)).toBe("unlimited");
    expect(parseUses("∞", PAGE)).toBe("unlimited");
    expect(parseUses("3", PAGE)).toBe(3);
    expect(parseUses("N/A", PAGE)).toBeNull();
    expect(parseDepartment("Orbital Cannons", PAGE)).toBe("orbital_cannons");
    expect(() => parseDepartment("Armory", PAGE)).toThrow("unknown ship department");
    expect(
      leadAbbreviations("The Orbital Precision Strike, abbreviated as OPS, is a Stratagem"),
    ).toEqual(["OPS"]);
    expect(leadAbbreviations("The GL-28 Belt-Fed Grenade Launcher (BFGL) is a Stratagem")).toEqual([
      "BFGL",
    ]);
    expect(leadAbbreviations(null)).toEqual([]);
  });

  it("knows every ship section of /wiki/Ship_Modules as a department", async () => {
    const page = await fixture("Ship Modules");
    const $ = loadHtml(page.html);
    const table = readWikitable($, $("#mw-content-text table.wikitable").first());
    expect(table.headers[0]).toBe("Ship Section");
    // Rows that open a section carry the rowspan'd section cell first.
    const sections = table.rows
      .map((tableRow) => tableRow.cells[0])
      .filter((cell) => cell?.attr("rowspan"))
      .map((cell) => (cell ? parseDepartment(textOf(cell), page.url) : null));
    expect(sections).toEqual(Department.options);
  });
});
