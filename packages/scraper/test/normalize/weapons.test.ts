import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Weapon } from "@hd2/schemas";
import { describe, expect, it } from "vitest";
import { NormalizeError } from "../../src/errors.ts";
import { classifySource, pageFromMarker } from "../../src/normalize/sources.ts";
import { WarbondResolver } from "../../src/normalize/warbonds.ts";
import { normalizeAttack, normalizeWeaponStats } from "../../src/normalize/weapons.ts";
import { parseWeaponPage } from "../../src/parsers/weapon-page.ts";
import { fixture } from "../fixtures.ts";

const example = JSON.parse(
  await readFile(
    join(import.meta.dirname, "../../../schemas/test/examples/weapons.ar-23-liberator.json"),
    "utf8",
  ),
) as Weapon;

async function stats(
  title: string,
  category: Weapon["category"],
  subcategory: Weapon["subcategory"],
  traitIds: string[] = [],
) {
  const page = await fixture(title);
  const raw = parseWeaponPage(page.html, { url: page.url });
  return normalizeWeaponStats(raw, { page: page.url, category, subcategory, traitIds });
}

describe("normalizeWeaponStats", () => {
  it("builds the AR-23 Liberator of arch §5.4 and logs its recoil conflict (rule 2)", async () => {
    const liberator = await stats("AR-23 Liberator", "primary", "assault_rifle", [
      "light-armor-penetrating",
    ]);
    expect(liberator.firearm).toEqual(example.firearm);
    expect(liberator.throwable).toBeNull();
    expect(liberator.attacks).toEqual(example.attacks);
    expect(liberator.statsRaw).toMatchObject(example.statsRaw);
    expect(liberator.statsRaw).toMatchObject({
      "AR-23 LIBERATOR › Recoil": "10.5",
      "5.5x50mm FULL METAL JACKET P › Damage › Standard": "90 Ballistic",
    });
    expect(liberator.conflicts).toEqual([
      {
        field: "firearm.recoil",
        rule: 2,
        chosen: 10.5,
        candidates: [
          { location: "infobox › Recoil", value: 14 },
          { location: "AR-23 LIBERATOR › Recoil", value: 10.5 },
        ],
      },
    ]);
  });

  it("keeps the infobox list when it has more fire rates", async () => {
    const tenderizer = await stats("AR-61 Tenderizer", "primary", "assault_rifle");
    expect(tenderizer.firearm?.fireRateRpm).toEqual([600, 850]);
    expect(tenderizer.firearm?.dps).toEqual([1050, 1487.5]);
    expect(tenderizer.conflicts.map((c) => c.field)).not.toContain("firearm.fireRateRpm");
  });

  it("reads the main mode of a weapon with an underbarrel and keeps the rest raw", async () => {
    const oneTwo = await stats("AR/GL-21 One-Two", "primary", "assault_rifle");
    expect(oneTwo.firearm).toMatchObject({
      firingModes: ["auto", "semi", "burst", "other"],
      fireRateRpm: [650],
      capacity: 40,
      spareMagazines: 6,
      reloadTimeS: 3.33,
      tacticalReloadTimeS: 1.95,
    });
    expect(oneTwo.attacks.map((attack) => [attack.name, attack.kind])).toEqual([
      ["AR/GL-21 P", "projectile"],
      ["40mm HEAT GRENADE P", "projectile"],
      ["40mm HEAT GRENADE P IE", "explosion"],
    ]);
    expect(oneTwo.attacks[2]).toMatchObject({
      damage: { standard: 400, durable: 400, type: "Explosion" },
      area: { innerRadiusM: 2.25, outerRadiusM: 6.5, shockwaveRadiusM: 8 },
      forces: { demolition: 30, stagger: 25, push: 30 },
    });
    expect(oneTwo.statsRaw["AR/GL-21 ONE-TWO › Underbarrel AR/GL-21 ONE-TWO 0 › Fire Rate"]).toBe(
      "900 rpm",
    );
    expect(oneTwo.statsRaw["Supply Box Refill"]).toBe("6 (8mm) / 3 (40mm)");
  });

  it("marks reload kinds from traits and heat weapons without a magazine count", async () => {
    const punisher = await stats("SG-8 Punisher", "primary", "shotgun", ["rounds-reload"]);
    expect(punisher.firearm).toMatchObject({ reloadKind: "rounds", reloadTimeS: 6.45 });
    expect(punisher.attacks[0]?.projectile?.pellets).toBe(9);

    const sickle = await stats("LAS-16 Sickle", "primary", "energy_based");
    expect(sickle.firearm).toMatchObject({ capacity: null, reloadKind: "magazine" });
  });

  it("gives melee weapons attacks but no firearm stats", async () => {
    const lance = await stats("CQC-19 Stun Lance", "secondary", "melee");
    expect(lance.firearm).toBeNull();
    expect(lance.attacks).toEqual([
      {
        name: "Stun Lance",
        kind: "melee",
        damage: { standard: 165, durable: 83, type: "Melee" },
        penetration: {
          direct: "medium",
          slightAngle: "unarmored",
          largeAngle: "unarmored",
          extremeAngle: "unarmored",
        },
        projectile: null,
        area: null,
        forces: { demolition: 10, stagger: 35, push: 30 },
      },
    ]);
  });

  it("reads throwable stats", async () => {
    const grenade = await stats("G-12 High Explosive", "throwable", "standard");
    expect(grenade.firearm).toBeNull();
    expect(grenade.throwable).toEqual({
      capacity: 5,
      startingCount: 4,
      fromSupply: 3,
      fuseTimeS: 3.5,
      cookable: true,
    });
    const dynamite = await stats("TED-63 Dynamite", "throwable", "standard");
    expect(dynamite.throwable?.fuseTimeS).toBe(5);
    const knife = await stats("K-2 Throwing Knife", "throwable", "special");
    expect(knife.throwable?.fuseTimeS).toBeNull();
  });

  it("reads status and spray attacks", async () => {
    const torcher = await stats("FLAM-66 Torcher", "primary", "special");
    expect(torcher.attacks.map((attack) => attack.kind)).toEqual([
      "spray",
      "status",
      "status",
      "status",
    ]);
    expect(torcher.attacks[1]?.damage).toEqual({ standard: 100, durable: 100, type: "Fire" });
  });
});

describe("normalizeAttack", () => {
  it("rejects an unknown attack table kind", () => {
    expect(() =>
      normalizeAttack({ kind: "laser-show", id: "x", title: "X", sections: [] }, "page"),
    ).toThrow(NormalizeError);
  });
});

describe("classifySource", () => {
  const PAGE = "https://helldivers.wiki.gg/wiki/AR-23_Liberator";
  const options = {
    warbonds: new WarbondResolver({
      aliases: { "Helldivers Mobilize!": "helldivers-mobilize" },
    }),
    sourceLabels: { "Starter Equipment": "default", Superstore: "superstore" } as const,
    page: PAGE,
  };

  it("reads warbond links with their page marker or anchor", () => {
    const link = { label: "Python Commandos", title: "Python Commandos Premium Warbond" };
    expect(
      classifySource(
        { label: "Python Commandos P1", link: { ...link, anchor: "Page_1" }, pageMarker: "Page 1" },
        options,
      ),
    ).toEqual({ type: "warbond", warbondId: "python-commandos", page: 1 });
    expect(
      classifySource(
        { label: "Python Commandos", link: { ...link, anchor: "Page_2" }, pageMarker: null },
        options,
      ),
    ).toEqual({ type: "warbond", warbondId: "python-commandos", page: 2 });
    expect(
      classifySource(
        {
          label: "Castellan’s Creed",
          link: {
            label: "Castellan’s Creed",
            title: "Castellan’s Creed Legendary Warbond",
            anchor: null,
          },
          pageMarker: null,
        },
        options,
      ),
    ).toEqual({ type: "warbond", warbondId: "castellans-creed", page: null });
  });

  it("maps labels, then warbond aliases, and fails on anything else", () => {
    expect(classifySource({ label: "Superstore", link: null, pageMarker: null }, options)).toEqual({
      type: "superstore",
      warbondId: null,
      page: null,
    });
    expect(
      classifySource(
        { label: "Helldivers Mobilize! P3", link: null, pageMarker: "Page 3" },
        options,
      ),
    ).toEqual({ type: "warbond", warbondId: "helldivers-mobilize", page: 3 });
    expect(() =>
      classifySource({ label: "Galactic War Reward", link: null, pageMarker: null }, options),
    ).toThrow("map it in data/overrides/source-labels.json");
  });

  it("reads page markers", () => {
    expect(pageFromMarker("Page 12")).toBe(12);
    expect(pageFromMarker("P1")).toBeNull();
    expect(pageFromMarker(null)).toBeNull();
  });
});
