import { z } from "zod";

// Field schemas shared by every entity (arch §5.1, §5.3).

export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

// URL segment of every v1 collection (arch §8.2).
export const Collection = z.enum([
  "warbonds",
  "weapons",
  "stratagems",
  "armors",
  "helmets",
  "capes",
  "armor-sets",
  "boosters",
  "passives",
  "weapon-traits",
  "player-cards",
  "emotes",
  "patterns",
  "titles",
]);

export const WikiFlag = z.enum(["potentially_outdated", "broken_file_links", "stub"]);

export const WikiRef = z.object({
  title: z.string().min(1), // canonical page title
  url: z.url({ protocol: /^https$/, hostname: /^helldivers\.wiki\.gg$/ }), // /wiki/<Title>[#anchor]
  flags: z
    .array(WikiFlag)
    .describe(
      "Maintenance banners the wiki shows on the page, copied as they are. They describe the wiki page, not this API's parsing.",
    ),
});

export const ImageUrl = z.string().regex(/^\/images\/v1\/[a-z-]+\/[a-z0-9-]+\.[a-f0-9]{8}\.webp$/);

export const Image = z.object({
  url: ImageUrl,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  wikiFile: z.string().min(1), // original file name on the wiki
});

export const Currency = z.enum(["medals", "super_credits", "requisition", "usd"]);
export const Cost = z.object({ currency: Currency, amount: z.number().nonnegative() });

export const SourceType = z.enum([
  "warbond",
  "superstore",
  "default",
  "requisition",
  "progression", // earned by level (rank titles)
  "pre_order",
  "twitch_drop",
  "edition",
  "event",
  "other",
]);

export const Source = z
  .object({
    type: SourceType,
    label: z
      .string()
      .describe(
        "The wiki's own text for the source, unedited: spelling varies between pages (`Helldivers Mobilize` and `Helldivers Mobilize!`, straight and curly apostrophes, `Halo: ODST` for Obedient Democracy Support Troopers) and warbond labels can end with the page (`Steeled Veterans P2`). Match and name warbonds with `warbondId` and `page`, never with this text.",
      ),
    warbondId: Id.nullable().describe(
      "The warbond's id in /v1/warbonds.json when `type` is `warbond`, else null. Its `name` there is the display name.",
    ),
    page: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        "The warbond page that unlocks the item (1 = first) when `type` is `warbond`, else null.",
      ),
    cost: Cost.nullable(),
    rotating: z.boolean().nullable(), // superstore only; null elsewhere
  })
  .superRefine((source, ctx) => {
    if (source.type === "warbond" && (!source.warbondId || !source.page)) {
      ctx.addIssue({ code: "custom", message: "warbond source needs warbondId and page" });
    }
    if (source.type !== "warbond" && source.warbondId) {
      ctx.addIssue({ code: "custom", message: "warbondId only allowed on warbond sources" });
    }
    if ((source.type === "superstore") !== (source.rotating !== null)) {
      ctx.addIssue({ code: "custom", message: "rotating is set only for superstore" });
    }
  });

export const Base = {
  id: Id,
  slug: Id,
  name: z.string().min(1),
  upcoming: z
    .boolean()
    .describe(
      'True while the wiki lists the item as announced but not in the game yet (its "Unreleased Content" category).',
    ),
  aliases: z.array(z.string()),
  description: z.string().nullable(),
  image: Image.nullable().describe(
    "A picture served by this API, or null while the wiki has none of its own. The URL is content-hashed: cache it forever. Sizes are the wiki file's, never enlarged, so a new item's provisional art can be smaller than the rest of its collection.",
  ),
  wiki: WikiRef,
};

/** The raw bag of weapon and stratagem pages (arch §5.1). */
export const StatsRaw = z
  .record(z.string(), z.string())
  .describe(
    "Every stat row of the wiki page as label → text, unedited: units, spelling and labels differ between pages (a grenade has `Damage` where a gun has `Standard Damage`; one infobox says `700`, another `700 rpm`). Read the typed fields first; this bag is for what they do not cover.",
  );

export const Penetration = z
  .string()
  .regex(/^(unarmored|very_light|light|medium|heavy|anti_tank_[ivx]+)$/);

export const Department = z.enum([
  "patriotic_administration_center",
  "orbital_cannons",
  "hangar",
  "bridge",
  "engineering_bay",
  "robotics_workshop",
]);

export type Id = z.infer<typeof Id>;
export type Collection = z.infer<typeof Collection>;
export type WikiFlag = z.infer<typeof WikiFlag>;
export type WikiRef = z.infer<typeof WikiRef>;
export type Image = z.infer<typeof Image>;
export type Currency = z.infer<typeof Currency>;
export type Cost = z.infer<typeof Cost>;
export type SourceType = z.infer<typeof SourceType>;
export type Source = z.infer<typeof Source>;
export type Penetration = z.infer<typeof Penetration>;
export type Department = z.infer<typeof Department>;
