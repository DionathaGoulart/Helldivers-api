import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverDataset, stagingDir, writeDataset } from "../../src/publish/write.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe("recoverable dataset publication", () => {
  let root: string;
  let data: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hd2-publish-"));
    data = join(root, "data");
    await mkdir(join(data, "v1"), { recursive: true });
    await mkdir(join(data, "overrides"));
    await writeFile(join(data, "v1", "old.json"), "old");
    await writeFile(join(data, "overrides", "ids.lock.json"), "old lock");
    vi.mocked(rename).mockClear();
  });
  afterEach(async () => {
    vi.mocked(rename).mockReset();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementation(actual.rename);
    await rm(root, { recursive: true, force: true });
  });
  const files = new Map([["new.json", { valid: true }]]);

  it("publishes the dataset, lock and archive together, preserving other overrides", async () => {
    await writeFile(join(data, "overrides", "aliases.json"), "aliases");
    await writeDataset(data, files, async (staged) => {
      await writeFile(join(staged, "overrides", "ids.lock.json"), "new lock");
      await mkdir(join(staged, "changelog"));
      await writeFile(join(staged, "changelog", "2026.json"), "archive");
    });
    expect(existsSync(join(data, "v1", "old.json"))).toBe(false);
    expect(JSON.parse(await readFile(join(data, "v1", "new.json"), "utf8"))).toEqual({
      valid: true,
    });
    expect(await readFile(join(data, "overrides", "ids.lock.json"), "utf8")).toBe("new lock");
    expect(await readFile(join(data, "overrides", "aliases.json"), "utf8")).toBe("aliases");
    expect(await readFile(join(data, "changelog", "2026.json"), "utf8")).toBe("archive");
  });

  it("leaves published files unchanged if archive or lock preparation fails", async () => {
    await expect(
      writeDataset(data, files, async (staged) => {
        await writeFile(join(staged, "overrides", "ids.lock.json"), "new lock");
        throw new Error("archive write failed");
      }),
    ).rejects.toThrow("archive write failed");
    expect(await readFile(join(data, "v1", "old.json"), "utf8")).toBe("old");
    expect(await readFile(join(data, "overrides", "ids.lock.json"), "utf8")).toBe("old lock");
  });

  it("rolls back when installing the staged directory fails", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementationOnce(actual.rename).mockRejectedValueOnce(new Error("EIO"));
    await expect(writeDataset(data, files)).rejects.toThrow("EIO");
    expect(await readFile(join(data, "v1", "old.json"), "utf8")).toBe("old");
    expect(await readFile(join(data, "overrides", "ids.lock.json"), "utf8")).toBe("old lock");
  });

  it("recovers an interrupted swap before reading the current dataset", async () => {
    await mkdir(stagingDir(data));
    await rename(data, join(stagingDir(data), "data.previous"));
    await recoverDataset(data);
    expect(await readFile(join(data, "v1", "old.json"), "utf8")).toBe("old");
    await writeDataset(data, files);
    expect(existsSync(join(data, "v1", "new.json"))).toBe(true);
  });

  it("does not erase a sibling dataset's recovery directory", async () => {
    const sibling = join(root, "other");
    await mkdir(join(stagingDir(sibling), "data.previous"), { recursive: true });
    await writeDataset(data, files);
    expect(existsSync(join(stagingDir(sibling), "data.previous"))).toBe(true);
  });
});
