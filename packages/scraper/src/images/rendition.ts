import type { Collection, ImageRendition } from "@hd2/schemas";

// Output size of each collection's images (arch §6.5, §5.4 examples).

export interface Box {
  width: number | null; // null: no limit on that side
  height: number | null;
}

export const RENDITION_BOX: Readonly<Record<ImageRendition, Box>> = {
  render: { width: 512, height: 512 }, // weapon, armor and pattern renders
  icon: { width: 256, height: null }, // SVG icons, emotes, titles
  card: { width: null, height: 512 }, // player cards
  cover: { width: 1024, height: null }, // warbond covers
};

// Weapon traits and armor sets have no picture on the wiki.
export const COLLECTION_RENDITION: Readonly<Partial<Record<Collection, ImageRendition>>> = {
  weapons: "render",
  armors: "render",
  helmets: "render",
  capes: "render",
  patterns: "render",
  boosters: "icon",
  passives: "icon",
  stratagems: "icon",
  emotes: "icon",
  titles: "icon",
  "player-cards": "card",
  warbonds: "cover",
};

/**
 * Size of a `width` × `height` picture scaled into the rendition's box, keeping its aspect
 * ratio. Rasters are never enlarged; vectors (`scalable`) always reach the box.
 */
export function fitSize(
  width: number,
  height: number,
  rendition: ImageRendition,
  scalable = false,
): { width: number; height: number } {
  const box = RENDITION_BOX[rendition];
  const scales = [
    box.width === null ? Number.POSITIVE_INFINITY : box.width / width,
    box.height === null ? Number.POSITIVE_INFINITY : box.height / height,
  ];
  const scale = scalable ? Math.min(...scales) : Math.min(1, ...scales);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
