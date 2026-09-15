import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readIdLock, writeIdLock } from "../src/node.ts";
import { IdCollisionError, IdLock, slugify } from "../src/slug.ts";

describe("slugify", () => {
  it.each([
    ["Castellan's Creed", "castellans-creed"],
    ["Castellan’s Creed", "castellans-creed"],
    ["R/40-K Hot-Shot Marksman Rifle", "r-40-k-hot-shot-marksman-rifle"],
    ["StA-X3 W.A.S.P. Launcher", "sta-x3-wasp-launcher"],
    ["AR/GL-21 One-Two", "ar-gl-21-one-two"],
    ["Helldivers Mobilize!", "helldivers-mobilize"],
    ["Halo: ODST", "halo-odst"],
    ["City Fighter's Resolve", "city-fighters-resolve"],
    ["40-K Meltagun", "40-k-meltagun"],
    ["Démocratie  Éternelle ", "democratie-eternelle"],
  ])("%s → %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it.each(["", "!!!", "’."])("rejects %j", (name) => {
    expect(() => slugify(name)).toThrow(/cannot slugify/);
  });
});

describe("IdLock", () => {
  it("locks a new id to its key", () => {
    const lock = IdLock.from({});
    expect(
      lock.resolve("warbonds", "Castellan's Creed Legendary Warbond", "Castellan's Creed"),
    ).toBe("castellans-creed");
    expect(lock.get("warbonds", "Castellan's Creed Legendary Warbond")).toBe("castellans-creed");
  });

  it("keeps the published id when the name changes", () => {
    const lock = IdLock.from({
      weapons: { "CQC-72 Entrenchment Tool": "cqc-72-entrenchment-tool" },
    });
    expect(lock.resolve("weapons", "CQC-72 Entrenchment Tool", "Trench Shovel")).toBe(
      "cqc-72-entrenchment-tool",
    );
  });

  it("scopes ids per collection", () => {
    const lock = IdLock.from({});
    expect(lock.resolve("armors", "TG-8 Sharpshooter", "TG-8 Sharpshooter")).toBe(
      "tg-8-sharpshooter",
    );
    expect(lock.resolve("helmets", "TG-8 Sharpshooter", "TG-8 Sharpshooter")).toBe(
      "tg-8-sharpshooter",
    );
  });

  it("refuses two keys that slugify to the same id", () => {
    const lock = IdLock.from({ warbonds: { "Castellan's Creed": "castellans-creed" } });
    expect(() => lock.resolve("warbonds", "Castellan’s Creed", "Castellan’s Creed")).toThrow(
      IdCollisionError,
    );
  });

  it("aliases a renamed title to its existing id", () => {
    const lock = IdLock.from({ warbonds: { "Halo: ODST": "halo-odst" } });
    lock.alias("warbonds", "Obedient Democracy Support Troopers", "halo-odst");
    expect(lock.get("warbonds", "Obedient Democracy Support Troopers")).toBe("halo-odst");
    expect(() => lock.alias("warbonds", "Halo: ODST", "other")).toThrow(/already locked/);
  });

  it("serializes collections in schema order and keys sorted", () => {
    const lock = IdLock.from({});
    lock.resolve("boosters", "Vitality Enhancement", "Vitality Enhancement");
    lock.resolve("warbonds", "Steeled Veterans", "Steeled Veterans");
    lock.resolve("boosters", "Hellpod Space Optimization", "Hellpod Space Optimization");

    expect(Object.keys(lock.toJSON())).toEqual(["warbonds", "boosters"]);
    expect(Object.keys(lock.toJSON().boosters ?? {})).toEqual([
      "Hellpod Space Optimization",
      "Vitality Enhancement",
    ]);
    expect(IdLock.from(JSON.parse(lock.serialize())).toJSON()).toEqual(lock.toJSON());
  });

  it("rejects invalid lock files", () => {
    expect(() => IdLock.from({ weapons: { "AR-23 Liberator": "AR-23" } })).toThrow();
    expect(() => IdLock.from({ enemies: {} })).toThrow();
  });
});

describe("readIdLock / writeIdLock", () => {
  let dir = "";

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("treats a missing file as an empty lock and round-trips through disk", async () => {
    dir = await mkdtemp(join(tmpdir(), "hd2-id-lock-"));
    const path = join(dir, "ids.lock.json");

    const lock = await readIdLock(path);
    expect(lock.toJSON()).toEqual({});

    lock.resolve("passives", "True Grit", "True Grit");
    await writeIdLock(path, lock);

    expect(await readFile(path, "utf8")).toBe(
      '{\n  "passives": {\n    "True Grit": "true-grit"\n  }\n}\n',
    );
    expect((await readIdLock(path)).get("passives", "True Grit")).toBe("true-grit");
  });
});
