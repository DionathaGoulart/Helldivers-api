import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/errors.ts";
import { parseStratagemPage } from "../../src/parsers/stratagem-page.ts";
import { parseStratagemsIndex, STRATAGEMS_INDEX } from "../../src/parsers/stratagems-index.ts";
import { article, fixture } from "../fixtures.ts";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe("stratagems-index parser", async () => {
  const index = await fixture(STRATAGEMS_INDEX);
  const rows = parseStratagemsIndex(index.html, { url: index.url });

  it("reads the 10 tables of the fixture with permit, group and table label", async () => {
    expect(rows).toHaveLength(114);
    const tally: Record<string, number> = {};
    for (const row of rows) {
      const key = [row.permit, row.group, row.label].filter(Boolean).join(" › ");
      tally[key] = (tally[key] ?? 0) + 1;
    }
    expect(tally).toEqual({
      "Offensive Permit › Orbital Strikes": 12,
      "Offensive Permit › Eagle Strikes": 8,
      "Supply Permit › Support Weapons": 33,
      "Supply Permit › Backpacks": 13,
      "Supply Permit › Vehicles": 8,
      "Defensive Permit › Sentries": 10,
      "Defensive Permit › Emplacements": 8,
      "Other › Mission Stratagems › Ship": 5,
      "Other › Mission Stratagems › Objective": 16,
      "Other › Mission Stratagems › Unavailable": 1,
    });
    await expect(json(rows)).toMatchFileSnapshot("./__snapshots__/stratagems-index.json");
  });

  it("reads code arrows, cooldown, icon-aware cost, level and source", () => {
    expect(rows[0]).toEqual({
      name: "Orbital Precision Strike",
      page: { label: "Orbital Precision Strike", title: "Orbital Precision Strike", anchor: null },
      permit: "Offensive Permit",
      group: "Orbital Strikes",
      label: null,
      code: ["Right", "Right", "Up"],
      cooldown: "90s",
      cost: { text: "Free", currency: null },
      unlockLevel: "1",
      source: { label: "Bridge", link: null, pageMarker: null },
      icon: {
        file: "Orbital_Precision_Strike_Stratagem_Icon_Background.svg",
        src: "/images/Orbital_Precision_Strike_Stratagem_Icon_Background.svg?e78550",
        width: 512,
        height: 512,
      },
    });
    expect(rows.find((row) => row.name === "CQC-20 Breaching Hammer")).toMatchObject({
      cost: { text: "75 Medals", currency: "medals" },
      unlockLevel: "N/A",
      source: {
        label: "Siege Breakers P1",
        link: { title: "Siege Breakers Premium Warbond", anchor: "Page_1" },
        pageMarker: "Page 1",
      },
    });
  });

  it("leaves cost, level and source null on mission tables", () => {
    expect(rows.find((row) => row.name === "Reinforce")).toMatchObject({
      permit: "Other",
      label: "Ship",
      cooldown: "0s",
      cost: null,
      unlockLevel: null,
      source: null,
    });
  });

  it("fails loudly when the layout changes", () => {
    const parse = (html: string) => () => parseStratagemsIndex(html, { url: index.url });
    expect(parse(article("<p>gone</p>"))).toThrow("h3 Offensive Permit");
    expect(parse(index.html.replaceAll("Stratagem Arrow Up.svg", "Arrow.svg"))).toThrow(ParseError);
    expect(parse(index.html.replaceAll(">Base Cooldown", ">Cooldown"))).toThrow(
      'missing column "Base Cooldown"',
    );
  });
});

describe("stratagem-page parser", async () => {
  const load = async (title: string) => {
    const page = await fixture(title);
    return parseStratagemPage(page.html, { url: page.url });
  };
  const ops = await load("Orbital Precision Strike");

  it("reads the Orbital Precision Strike page", async () => {
    await expect(json(ops)).toMatchFileSnapshot("./__snapshots__/stratagem-page.ops.json");
    expect(ops).toMatchObject({
      title: "Orbital Precision Strike",
      name: "Orbital Precision Strike",
      code: ["Right", "Right", "Up"],
      source: { label: "Bridge", link: null, pageMarker: null },
      cost: { text: "Free", currency: null },
    });
    expect(ops.infobox.map((row) => [row.key, row.text, row.tab])).toEqual([
      ["permit_type", "Offensive", null],
      ["traits", "Explosive • Orbital • Anti-Tank", null],
      ["stratagem_code", "", null],
      ["base_cooldown", "90s", null],
      ["unlock_level", "1", null],
      ["unlock_cost", "Free", null],
      ["source", "Bridge", null],
    ]);
    expect(ops.tables.map((table) => table.kind)).toEqual(["weapon", "projectile", "explosion"]);
  });

  it("reads the General table with rowspan labels and variants", () => {
    expect(ops.general).toEqual([
      { section: "General", label: "Call-in Time", variant: "Standard", text: "4.45 seconds" },
      { section: "General", label: "Call-in Time", variant: "Upgraded", text: "3.45 seconds" },
      { section: "General", label: "Uses", variant: null, text: "Unlimited" },
      { section: "General", label: "Cooldown", variant: "Standard", text: "90 seconds" },
      {
        section: "General",
        label: "Cooldown",
        variant: "With Morale Augmentation",
        text: "85.5 seconds",
      },
      {
        section: "General",
        label: "Cooldown",
        variant: "With Zero-G Breech Loading",
        text: "81 seconds",
      },
      {
        section: "General",
        label: "Cooldown",
        variant: "With All Upgrades",
        text: "76.95 seconds",
      },
    ]);
  });

  it("carries a department over its rowspan in the ship modules table", async () => {
    expect(ops.shipModules.map((module) => [module.department, module.module])).toEqual([
      ["Orbital Cannons", "Exploding Shrapnel"],
      ["Orbital Cannons", "Zero-G Breech Loading"],
      ["Orbital Cannons", "High-Density Explosives"],
      ["Bridge", "Targeting Software Upgrade"],
      ["Bridge", "Morale Augmentation"],
    ]);
    // `rowspan="2""`: the malformed attribute still spans two rows.
    const napalm = await load("EAT-700 Expendable Napalm");
    expect(napalm.shipModules.map((module) => module.department)).toEqual([
      "Patriotic Administration Center",
      "Bridge",
      "Bridge",
    ]);
  });

  it("reads each row of a tabbed infobox from the tab that fills it", async () => {
    const mg43 = await load("MG-43 Machine Gun");
    const row = (key: string) => mg43.infobox.find((candidate) => candidate.key === key);
    expect(row("permit_type")).toMatchObject({ text: "Supply", tab: "Stratagem" });
    expect(row("fire_rate")).toMatchObject({ text: "630rpm • 760rpm • 900rpm", tab: "Weapon" });
    expect(row("source")).toMatchObject({ text: "Patriotic Administration Center", tab: null });
    expect(mg43.code).toEqual(["Down", "Left", "Down", "Up", "Right"]);
    // The Stratagem tab holds the icon; the Weapon tab holds the render.
    expect(mg43.image?.file).toBe("Machine_Gun_Stratagem_Icon_Background.svg");
  });

  it("reads section rows and td labels of the General table", async () => {
    const sentry = await load("A/G-16 Gatling Sentry");
    expect(sentry.general.filter((row) => row.section === "Sentry")).toEqual([
      { section: "Sentry", label: "Fire Rate", variant: null, text: "1600 RPM" },
      { section: "Sentry", label: "Ammo", variant: "Standard", text: "500" },
      { section: "Sentry", label: "Ammo", variant: "Upgraded", text: "750" },
      { section: "Sentry", label: "Turn Rate", variant: "Standard", text: "96 °/s" },
      { section: "Sentry", label: "Turn Rate", variant: "Upgraded", text: "160 °/s" },
      { section: "Sentry", label: "Health", variant: "Standard", text: "400" },
      { section: "Sentry", label: "Health", variant: "Upgraded", text: "600" },
    ]);
    const exosuit = await load("EXO-49 Emancipator Exosuit");
    expect(exosuit.general.slice(0, 2)).toEqual([
      { section: "General", label: "Call-in Time", variant: null, text: "10.50 seconds" },
      { section: "General", label: "Uses", variant: null, text: "3" },
    ]);
  });

  it("reads the stratagem infobox of a mission objective page", async () => {
    const pods = await load("Reinforcement Pods");
    expect(pods).toMatchObject({
      title: "Reinforcement Pods",
      name: "Link Hellpods to Destroyer",
      source: null,
      cost: null,
      general: [],
      shipModules: [],
    });
  });

  it("fails on a row filled in two tabs", async () => {
    const page = await fixture("MG-43 Machine Gun");
    const html = page.html.replace(
      'data-druid-tab-key="Weapon"></div>',
      'data-druid-tab-key="Weapon">Offensive</div>',
    );
    expect(() => parseStratagemPage(html, { url: page.url })).toThrow("filled in several tabs");
  });
});
