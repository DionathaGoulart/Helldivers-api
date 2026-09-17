import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sharpEncoder } from "../../src/images/encode.ts";

// Real sharp on original wiki files saved with `pnpm fixtures:update --images`.
const IMAGES_DIR = join(import.meta.dirname, "..", "fixtures", "images");
const fixtureImage = (file: string) => readFile(join(IMAGES_DIR, file));

describe("sharpEncoder", () => {
  const webp = (body: Buffer) => body.subarray(0, 4).toString() + body.subarray(8, 12).toString();

  it("rasterizes SVG icons to 256 px wide WebP", async () => {
    const icon = await sharpEncoder.encode(
      await fixtureImage("Hellpod_Space_Optimization_Booster_Icon.svg"),
      "icon",
      true,
    );
    expect(webp(icon.body)).toBe("RIFFWEBP");
    expect(icon).toMatchObject({ width: 256, height: 256 });
    expect(await sharp(icon.body).metadata()).toMatchObject({ width: 256, height: 256 });

    const title = await sharpEncoder.encode(
      await fixtureImage("Viper_Commando_Title_Icon.svg"),
      "icon",
      true,
    );
    expect(title).toMatchObject({ width: 256, height: 315 }); // arch §5.4
  });

  it("scales rasters down, never up, and keeps transparency", async () => {
    const emote = await sharpEncoder.encode(
      await fixtureImage("Test_of_Conviction_Emote_Icon.png"),
      "icon",
      false,
    );
    expect(emote).toMatchObject({ width: 256, height: 256 });
    expect(emote.body.byteLength).toBeLessThan(150 * 1024);

    const small = await sharp({
      create: { width: 129, height: 298, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const render = await sharpEncoder.encode(small, "render", false);
    expect(render).toMatchObject({ width: 129, height: 298 });
    expect(await sharp(render.body).metadata()).toMatchObject({ hasAlpha: true });
  });

  it("yields identical bytes for the same input", async () => {
    for (const [file, rendition, vector] of [
      ["Hellpod_Space_Optimization_Booster_Icon.svg", "icon", true],
      ["Test_of_Conviction_Emote_Icon.png", "icon", false],
    ] as const) {
      const input = await fixtureImage(file);
      const first = await sharpEncoder.encode(input, rendition, vector);
      const second = await sharpEncoder.encode(Buffer.from(input), rendition, vector);
      expect(second.body.equals(first.body), file).toBe(true);
    }
  });

  it("fails on bytes that are not an image", async () => {
    await expect(sharpEncoder.encode(Buffer.from("<html>"), "icon", false)).rejects.toThrow();
  });
});
