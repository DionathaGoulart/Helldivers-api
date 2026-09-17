import { describe, expect, it } from "vitest";
import { downloadPath, imageVersion, isVector } from "../../src/images/download.ts";
import { fitSize } from "../../src/images/rendition.ts";

describe("fitSize", () => {
  it.each([
    [3840, 2160, "render", false, 512, 288], // AR-23 render
    [1024, 1024, "render", false, 512, 512],
    [395, 949, "render", false, 213, 512], // tall armor render
    [129, 298, "render", false, 129, 298], // small rasters are never enlarged
    [512, 512, "icon", true, 256, 256],
    [512, 629, "icon", true, 256, 315], // Viper Commando title
    [256, 256, "icon", true, 256, 256],
    [128, 128, "icon", true, 256, 256], // vectors reach the box
    [915, 1829, "card", false, 256, 512], // City Fighter's Resolve card
    [420, 780, "card", false, 276, 512],
    [2048, 1024, "cover", false, 1024, 512],
    [2047, 1123, "cover", false, 1024, 562],
  ] as const)("%i×%i %s (vector %s) → %i×%i", (width, height, rendition, vector, w, h) => {
    expect(fitSize(width, height, rendition, vector)).toEqual({ width: w, height: h });
  });
});

describe("downloadPath", () => {
  const image = (src: string, width: number | null, height: number | null, file?: string) => ({
    file: file ?? (/([^/]+?)(?:\?|$)/.exec(src.split("/").at(-1) ?? "")?.[1] as string),
    src,
    width,
    height,
  });

  it("reads the version suffix", () => {
    expect(imageVersion("/images/A.png?97e7bb")).toBe("97e7bb");
    expect(imageVersion("/images/A.png")).toBeNull();
    expect(isVector("A_Icon.SVG")).toBe(true);
  });

  it("takes SVG originals and keeps the version suffix", () => {
    expect(downloadPath(image("/images/Icon.svg?7aa15a", 512, 512), "icon")).toBe(
      "/images/Icon.svg?7aa15a",
    );
  });

  it("takes the smallest standard thumbnail at least as wide as the output", () => {
    const render = "/images/thumb/AR-23.png/600px-AR-23.png?97e7bb";
    expect(downloadPath(image(render, 3840, 2160, "AR-23.png"), "render")).toBe(
      "/images/thumb/AR-23.png/512px-AR-23.png?97e7bb",
    );
    // 213 px wide output: the 256 px thumbnail.
    expect(downloadPath(image("/images/Tall.png?1", 395, 949), "render")).toBe(
      "/images/thumb/Tall.png/256px-Tall.png?1",
    );
    expect(downloadPath(image("/images/Cover.png?2", 2048, 1024), "cover")).toBe(
      "/images/thumb/Cover.png/1024px-Cover.png?2",
    );
  });

  it("takes the original when no standard thumbnail is narrower, or its size is unknown", () => {
    expect(downloadPath(image("/images/Card.png?3", 420, 780), "card")).toBe("/images/Card.png?3");
    expect(downloadPath(image("/images/Helmet.png?4", 512, 512), "render")).toBe(
      "/images/Helmet.png?4",
    );
    expect(downloadPath(image("/images/Unknown.png", null, null), "render")).toBe(
      "/images/Unknown.png",
    );
  });

  it("keeps the wiki's own file name encoding", () => {
    const src = "/images/thumb/Liberty%27s_Herald.png/200px-Liberty%27s_Herald.png?b9";
    expect(downloadPath(image(src, 915, 1829, "Liberty's_Herald.png"), "card")).toBe(
      "/images/thumb/Liberty%27s_Herald.png/256px-Liberty%27s_Herald.png?b9",
    );
  });
});
