import type { CollectionEntity } from "./collections.ts";
import { Collection, type Cost, type Id, type Image, type Source } from "./common.ts";
import type { PatternTarget } from "./entities/cosmetics.ts";

// Cross-collection checks run after every entity passed its schema (arch §5.3, §5.5).
// Every issue is fatal for a publish.

export type Dataset = { [C in Collection]?: readonly CollectionEntity<C>[] };

export interface IntegrityIssue {
  collection: Collection;
  id: Id;
  field: string; // "source.page", "pages[0].items[4].ref.id"
  message: string;
}

export interface IntegrityOptions {
  /** Image URLs from the B2 upload manifest; the manifest check runs only when given. */
  imageUrls?: ReadonlySet<string>;
  /**
   * Ids known to exist in collections this dataset does not have yet (temporary warbond
   * stubs until the warbonds collection is scraped, plan §4). Ignored for present collections.
   */
  knownIds?: { readonly [C in Collection]?: ReadonlySet<Id> };
}

const SOURCED = [
  "weapons",
  "stratagems",
  "armors",
  "helmets",
  "capes",
  "boosters",
  "player-cards",
  "emotes",
  "titles",
] as const satisfies readonly Collection[];

const IMAGED = Collection.options.filter(
  (collection): collection is Exclude<Collection, "armor-sets"> => collection !== "armor-sets",
);

const formatCost = (cost: Cost | null) => (cost ? `${cost.amount} ${cost.currency}` : "no cost");

export function checkIntegrity(dataset: Dataset, options: IntegrityOptions = {}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const report = (collection: Collection, id: Id, field: string, message: string) => {
    issues.push({ collection, id, field, message });
  };
  const list = <C extends Collection>(collection: C): readonly CollectionEntity<C>[] =>
    dataset[collection] ?? [];

  // Ids unique per collection.
  const index = new Map<Collection, Set<Id>>();
  for (const collection of Collection.options) {
    const seen = new Set<Id>();
    for (const entity of list(collection)) {
      if (seen.has(entity.id)) {
        report(collection, entity.id, "id", "duplicate id");
      }
      seen.add(entity.id);
    }
    index.set(collection, seen);
  }

  const exists = (collection: Collection, id: Id) =>
    dataset[collection] === undefined
      ? (options.knownIds?.[collection]?.has(id) ?? false)
      : (index.get(collection)?.has(id) ?? false);
  const ref = (from: Collection, id: Id, field: string, target: Collection, targetId: Id) => {
    if (!exists(target, targetId)) {
      report(from, id, field, `${target}/${targetId} does not exist`);
    }
  };
  const refs = (
    from: Collection,
    id: Id,
    field: string,
    target: Collection,
    ids: readonly Id[],
  ) => {
    ids.forEach((targetId, i) => {
      ref(from, id, `${field}[${i}]`, target, targetId);
    });
  };
  // A materialized back-reference list must equal the ids that reference its owner.
  const backRefs = (
    from: Collection,
    id: Id,
    field: string,
    target: Collection,
    actual: readonly Id[],
    expected: readonly Id[],
  ) => {
    refs(from, id, field, target, actual);
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    if (actualSet.size !== actual.length) {
      report(from, id, field, "duplicate ids");
    }
    for (const other of expectedSet) {
      if (!actualSet.has(other)) {
        report(from, id, field, `missing ${target}/${other}, which references ${from}/${id}`);
      }
    }
    for (const other of actualSet) {
      if (exists(target, other) && !expectedSet.has(other)) {
        report(from, id, field, `lists ${target}/${other}, which does not reference ${from}/${id}`);
      }
    }
  };

  // Warbond pages and item refs; pattern refs name an existing variant.
  const patterns = new Map(list("patterns").map((pattern) => [pattern.id, pattern]));
  for (const warbond of list("warbonds")) {
    warbond.pages.forEach((page, p) => {
      if (page.number !== p + 1) {
        report(
          "warbonds",
          warbond.id,
          `pages[${p}].number`,
          `expected page ${p + 1}, got ${page.number}`,
        );
      }
      page.items.forEach((item, i) => {
        const itemRef = item.ref;
        if (!itemRef) {
          return;
        }
        const field = `pages[${p}].items[${i}].ref`;
        ref("warbonds", warbond.id, `${field}.id`, itemRef.collection, itemRef.id);
        if (itemRef.collection !== "patterns") {
          if (itemRef.variant !== null) {
            report(
              "warbonds",
              warbond.id,
              `${field}.variant`,
              "variant is only allowed on pattern refs",
            );
          }
          return;
        }
        const pattern = patterns.get(itemRef.id);
        if (itemRef.variant === null) {
          report("warbonds", warbond.id, `${field}.variant`, "pattern refs need a variant");
        } else if (pattern && !pattern.variants.some((v) => v.target === itemRef.variant)) {
          report(
            "warbonds",
            warbond.id,
            `${field}.variant`,
            `patterns/${pattern.id} has no ${itemRef.variant} variant`,
          );
        }
      });
    });
  }

  // Warbond sources resolve, fit the page count and are listed there at the same cost.
  const warbonds = new Map(list("warbonds").map((warbond) => [warbond.id, warbond]));
  const checkSource = (
    collection: Collection,
    id: Id,
    field: string,
    source: Source,
    variant: PatternTarget | null,
  ) => {
    if (source.warbondId === null || source.page === null) {
      return;
    }
    const warbond = warbonds.get(source.warbondId);
    if (!warbond) {
      if (!exists("warbonds", source.warbondId)) {
        report(collection, id, `${field}.warbondId`, `warbonds/${source.warbondId} does not exist`);
      }
      return; // a known but unscraped warbond has no pages to check yet
    }
    if (source.page > warbond.pages.length) {
      report(
        collection,
        id,
        `${field}.page`,
        `warbonds/${warbond.id} has ${warbond.pages.length} pages`,
      );
      return;
    }
    const listed = warbond.pages
      .find((page) => page.number === source.page)
      ?.items.find(
        (item) =>
          item.ref?.collection === collection &&
          item.ref.id === id &&
          (variant === null || item.ref.variant === variant),
      );
    const what = `${collection}/${id}${variant ? ` (${variant})` : ""}`;
    if (!listed) {
      report(
        collection,
        id,
        `${field}.page`,
        `warbonds/${warbond.id} page ${source.page} does not list ${what}`,
      );
    } else if (
      listed.cost.currency !== source.cost?.currency ||
      listed.cost.amount !== source.cost.amount
    ) {
      report(
        collection,
        id,
        `${field}.cost`,
        `warbonds/${warbond.id} page ${source.page} lists ${what} for ${formatCost(listed.cost)}, source says ${formatCost(source.cost)}`,
      );
    }
  };
  for (const collection of SOURCED) {
    for (const entity of list(collection)) {
      checkSource(collection, entity.id, "source", entity.source, null);
    }
  }
  for (const pattern of list("patterns")) {
    pattern.variants.forEach((variant, i) => {
      checkSource("patterns", pattern.id, `variants[${i}].source`, variant.source, variant.target);
    });
  }

  // Passives ⇄ armors.
  for (const armor of list("armors")) {
    ref("armors", armor.id, "passiveId", "passives", armor.passiveId);
  }
  for (const passive of list("passives")) {
    const armorIds = list("armors")
      .filter((armor) => armor.passiveId === passive.id)
      .map((armor) => armor.id);
    backRefs("passives", passive.id, "armorIds", "armors", passive.armorIds, armorIds);
  }

  // Weapon traits ⇄ weapons and stratagems.
  for (const collection of ["weapons", "stratagems"] as const) {
    for (const entity of list(collection)) {
      refs(collection, entity.id, "traitIds", "weapon-traits", entity.traitIds);
    }
  }
  for (const trait of list("weapon-traits")) {
    const holders = (collection: "weapons" | "stratagems") =>
      list(collection)
        .filter((entity) => entity.traitIds.includes(trait.id))
        .map((entity) => entity.id);
    backRefs(
      "weapon-traits",
      trait.id,
      "weaponIds",
      "weapons",
      trait.weaponIds,
      holders("weapons"),
    );
    backRefs(
      "weapon-traits",
      trait.id,
      "stratagemIds",
      "stratagems",
      trait.stratagemIds,
      holders("stratagems"),
    );
  }

  // Armor sets: parts resolve, every armor in exactly one set, parts point back.
  const sets = list("armor-sets");
  for (const set of sets) {
    ref("armor-sets", set.id, "armorId", "armors", set.armorId);
    ref("armor-sets", set.id, "helmetId", "helmets", set.helmetId);
    if (set.capeId !== null) {
      ref("armor-sets", set.id, "capeId", "capes", set.capeId);
    }
    if ((set.capeId === null) !== (set.capeLink === null)) {
      report("armor-sets", set.id, "capeLink", "capeLink is set exactly when capeId is");
    }
  }
  for (const armor of list("armors")) {
    const setIds = sets.filter((set) => set.armorId === armor.id).map((set) => set.id);
    if (setIds.length !== 1) {
      report(
        "armors",
        armor.id,
        "setIds",
        `must be in exactly one armor set, found ${setIds.length}`,
      );
    }
    backRefs("armors", armor.id, "setIds", "armor-sets", armor.setIds, setIds);
  }
  for (const helmet of list("helmets")) {
    const setIds = sets.filter((set) => set.helmetId === helmet.id).map((set) => set.id);
    backRefs("helmets", helmet.id, "setIds", "armor-sets", helmet.setIds, setIds);
  }
  for (const cape of list("capes")) {
    const setIds = sets.filter((set) => set.capeId === cape.id).map((set) => set.id);
    backRefs("capes", cape.id, "setIds", "armor-sets", cape.setIds, setIds);
  }

  // Cape ⇄ player card are mutual.
  const capes = new Map(list("capes").map((cape) => [cape.id, cape]));
  const cards = new Map(list("player-cards").map((card) => [card.id, card]));
  for (const cape of capes.values()) {
    if (cape.playerCardId === null) {
      continue;
    }
    const card = cards.get(cape.playerCardId);
    if (!card) {
      report("capes", cape.id, "playerCardId", `player-cards/${cape.playerCardId} does not exist`);
    } else if (card.pairedCapeId !== cape.id) {
      report(
        "capes",
        cape.id,
        "playerCardId",
        `player-cards/${card.id} is not paired with this cape`,
      );
    }
  }
  for (const card of cards.values()) {
    if (card.pairedCapeId === null) {
      continue;
    }
    const cape = capes.get(card.pairedCapeId);
    if (!cape) {
      report("player-cards", card.id, "pairedCapeId", `capes/${card.pairedCapeId} does not exist`);
    } else if (cape.playerCardId !== card.id) {
      report(
        "player-cards",
        card.id,
        "pairedCapeId",
        `capes/${cape.id} is not paired with this card`,
      );
    }
  }

  // Image keys follow `images/v1/<collection>/<id>[-<variant>]` and are uploaded.
  const checkImage = (collection: Collection, id: Id, field: string, image: Image | null) => {
    if (!image) {
      return;
    }
    const prefix = `/images/v1/${collection}/${id}`;
    if (!image.url.startsWith(`${prefix}.`) && !image.url.startsWith(`${prefix}-`)) {
      report(collection, id, `${field}.url`, `expected a key under ${prefix}`);
    }
    if (options.imageUrls && !options.imageUrls.has(image.url)) {
      report(collection, id, `${field}.url`, "not in the image upload manifest");
    }
  };
  for (const collection of IMAGED) {
    for (const entity of list(collection)) {
      checkImage(collection, entity.id, "image", entity.image);
    }
  }
  for (const pattern of list("patterns")) {
    pattern.variants.forEach((variant, i) => {
      checkImage("patterns", pattern.id, `variants[${i}].image`, variant.image);
    });
  }

  return issues;
}
