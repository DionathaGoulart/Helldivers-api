import { z } from "zod";
import { ParseError, parseRaw } from "../errors.ts";
import { loadHtml, textOf } from "../wiki/html.ts";
import { firstArticleLink, firstImage } from "../wiki/links.ts";
import { ownElements, readTabberPanels } from "../wiki/tabber.ts";
import { RawImage, RawLink } from "./raw.ts";

// `/wiki/Weapons` (arch §4.3): tabber `Primary` › `Assault Rifle` … `Special`, `Secondary` ›
// `Pistol` `Melee` `Special`, `Throwable` › `Standard` `Special`; items are
// `li.gallerybox .gallerytext big a`. The support weapon tabs (ship departments, warbonds)
// list stratagems and are skipped; `Civilian` arrives in plan 3e.

export const WEAPONS_INDEX = "Weapons";

export const WEAPON_CATEGORY_TABS = ["Primary", "Secondary", "Throwable"] as const;

export const RawWeaponRow = z.object({
  name: z.string().min(1),
  page: RawLink,
  category: z.enum(WEAPON_CATEGORY_TABS), // outer tab
  subcategory: z.string().min(1), // inner tab label, "Assault Rifle"
  image: RawImage.nullable(),
});

export type RawWeaponRow = z.infer<typeof RawWeaponRow>;

const ITEM = "li.gallerybox";

export function parseWeaponsIndex(html: string, { url }: { url: string }): RawWeaponRow[] {
  const $ = loadHtml(html);
  const panels = readTabberPanels($, $("#mw-content-text"));

  const rows: RawWeaponRow[] = [];
  for (const category of WEAPON_CATEGORY_TABS) {
    const outer = panels.filter((panel) => panel.path.join("/") === category);
    if (outer.length !== 1) {
      throw new ParseError(url, `tabber panel ${category}`, `expected 1, found ${outer.length}`);
    }
    const inner = panels.filter((panel) => panel.path.length === 2 && panel.path[0] === category);
    if (inner.length === 0) {
      throw new ParseError(url, `tabber panel ${category} › *`, "no subcategory tabs");
    }
    for (const panel of inner) {
      const selector = `#${panel.id} ${ITEM}`;
      const items = ownElements($, panel, ITEM);
      if (items.length === 0) {
        throw new ParseError(url, selector, "no weapons");
      }
      items.each((i, element) => {
        const item = $(element);
        const link = item.find(".gallerytext big");
        rows.push(
          parseRaw(
            RawWeaponRow,
            {
              name: textOf(link),
              page: firstArticleLink(link),
              category,
              subcategory: panel.label,
              image: firstImage(item.find(".thumb")),
            },
            url,
            `${selector}:eq(${i})`,
          ),
        );
      });
    }
  }
  return rows;
}
