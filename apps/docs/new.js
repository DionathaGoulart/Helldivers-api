// What's new page: the last 30 days of the catalog, built in the browser from two static files,
// /v1/all.json and /v1/changelog.json, so it never touches the query or search limits. Three
// sections: what is announced, the warbonds released in the window with everything they sell (and
// the passives and traits that came out with them), and what the daily run added. An item shows
// once. No framework, no dependency.

const WINDOW_DAYS = 30;

/**
 * The first import: the catalog went up on 2026-09-15 and 16, so every item was "added" then, and
 * those runs also picked up old pages the scraper had missed. None of it is news.
 */
const IMPORTED_UNTIL = "2026-09-16";

/** Card title per collection, in the order announced items are listed. */
const LABELS = {
  warbonds: "Warbond",
  weapons: "Weapon",
  stratagems: "Stratagem",
  armors: "Armor",
  helmets: "Helmet",
  capes: "Cape",
  boosters: "Booster",
  passives: "Armor passive",
  "weapon-traits": "Equipment trait",
  "player-cards": "Player card",
  emotes: "Emote",
  patterns: "Pattern",
  titles: "Title",
};
// Armor sets are left out: a set repeats its armor (name, picture and flag), which stands for it.

/** Picture shape per collection, as on the examples page; the rest are wide. */
const MEDIA = {
  stratagems: "icon",
  boosters: "icon",
  passives: "icon",
  "weapon-traits": "icon",
  emotes: "icon",
  titles: "icon",
  "player-cards": "tall",
};

const CURRENCIES = {
  medals: "medals",
  super_credits: "Super Credits",
  requisition: "Requisition Slips",
};

const number = new Intl.NumberFormat("en-US");

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// --- Formatting -------------------------------------------------------------------------------

function formatCost(cost) {
  if (!cost) return null;
  if (cost.amount === 0) return "Free";
  const amount = number.format(cost.amount);
  if (cost.currency === "usd") return `US$ ${amount}`;
  return `${amount} ${CURRENCIES[cost.currency] ?? cost.currency.replaceAll("_", " ")}`;
}

/** `Hangar · 10,000 Requisition Slips`; a label the cost already says is not repeated. */
function sourceLine(source) {
  if (!source) return null;
  const cost = formatCost(source.cost);
  if (cost?.includes(source.label)) return cost;
  return [source.label, cost].filter(Boolean).join(" · ");
}

// --- DOM --------------------------------------------------------------------------------------

/** createElement with attributes and children; text is always text, never parsed as HTML. */
function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const dots = () =>
  h("span", { class: "window-dots", "aria-hidden": "true" }, h("span"), h("span"), h("span"));

const windowBar = (title) =>
  h("div", { class: "window-bar" }, h("span", { class: "window-bar-title" }, title), dots());

function media(picture, kind = "wide") {
  const image = picture?.url
    ? h("img", {
        src: picture.url,
        width: picture.width,
        height: picture.height,
        alt: "",
        loading: "lazy",
        decoding: "async",
      })
    : h("span", { class: "micro" }, "No image");
  return h("figure", { class: `ex-media${kind === "wide" ? "" : ` ex-media-${kind}`}` }, image);
}

const tag = (text, kind = "muted") => h("span", { class: `tag tag-${kind}` }, text);

/** One entity: its picture, its name linking to its JSON, and a foot ending in its wiki page. */
function card(collection, entity, { stats = [], tags = [], foot = null } = {}) {
  const shownStats = stats.filter(([, value]) => value !== null && value !== undefined);
  const picture = entity.image ?? entity.variants?.[0]?.image;
  const wiki = entity.wiki?.url;
  return h(
    "article",
    { class: "panel ex-card" },
    windowBar(collection === "warbonds" ? `${entity.type} warbond` : LABELS[collection]),
    media(picture, MEDIA[collection]),
    h(
      "div",
      { class: "ex-body" },
      h(
        "h3",
        { class: "ex-name" },
        h("a", { href: `/v1/${collection}/${entity.id}.json` }, entity.name),
      ),
      shownStats.length > 0 &&
        h(
          "dl",
          { class: "ex-stats" },
          shownStats.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))),
        ),
      tags.length > 0 && h("p", { class: "ex-tags" }, tags),
      h(
        "p",
        { class: "micro ex-foot" },
        foot,
        foot && wiki && " · ",
        wiki && h("a", { href: wiki }, "Wiki"),
      ),
    ),
  );
}

function warbondStats(warbond, items) {
  return [
    ["Released", warbond.releaseDate],
    ["Price", formatCost(warbond.cost)],
    ["Pages", warbond.pages?.length],
    ["Items", items.length],
    ["Medals for all", warbond.medalsAllItems ? number.format(warbond.medalsAllItems) : null],
  ];
}

const empty = (text) => h("p", { class: "hint new-empty" }, text);

// --- What's new -------------------------------------------------------------------------------

const keyOf = (collection, id) => `${collection}/${id}`;

/** Every item a warbond sells that the catalog has, once each, in page order. */
function warbondItems(warbond, catalog) {
  const items = new Map();
  for (const page of warbond.pages ?? []) {
    for (const item of page.items) {
      const key = item.ref && keyOf(item.ref.collection, item.ref.id);
      if (!key || items.has(key) || !catalog.has(key)) continue;
      items.set(key, { ...catalog.get(key), page: page.number, cost: item.cost });
    }
  }
  return [...items.values()];
}

/** The entities that carry a passive or a trait: its armors, or its weapons and stratagems. */
const CARRIERS = {
  passives: (passive) => passive.armorIds.map((id) => keyOf("armors", id)),
  "weapon-traits": (trait) => [
    ...trait.weaponIds.map((id) => keyOf("weapons", id)),
    ...trait.stratagemIds.map((id) => keyOf("stratagems", id)),
  ],
};

/**
 * Passives and traits that came out with a warbond: not sold on its pages, but carried by its items
 * and by nothing older. An item from a store, an event or the base game has no date, so it counts
 * as older; a later warbond reusing the passive does not take it away.
 */
function warbondDebuts(warbond, items, catalog, released) {
  const sold = new Set(items.map(({ collection, entity }) => keyOf(collection, entity.id)));
  const notOlder = (key) => {
    if (sold.has(key)) return true;
    const warbondId = catalog.get(key)?.entity.source?.warbondId;
    return (released.get(warbondId) ?? "") >= warbond.releaseDate;
  };
  const debuts = [];
  for (const { collection, entity } of catalog.values()) {
    const carriers = CARRIERS[collection]?.(entity) ?? [];
    if (!carriers.some((key) => sold.has(key)) || !carriers.every(notOlder)) continue;
    const names = carriers
      .filter((key) => sold.has(key))
      .map((key) => catalog.get(key).entity.name);
    debuts.push({ collection, entity, carriers: [...new Set(names)] });
  }
  return debuts;
}

/** The three sections, from the two files; `shown` keeps an item to the first that claims it. */
function whatsNew(all, changelog, today, since) {
  const catalog = new Map();
  for (const [collection, entities] of Object.entries(all)) {
    if (!(collection in LABELS)) continue;
    for (const entity of entities) {
      catalog.set(keyOf(collection, entity.id), { collection, entity });
    }
  }
  const shown = new Set();
  const released = new Map(all.warbonds.map((warbond) => [warbond.id, warbond.releaseDate]));

  // A warbond out in the window keeps its items, even those the wiki still marks unreleased.
  const warbonds = all.warbonds
    .filter((w) => !w.upcoming && w.releaseDate >= since && w.releaseDate <= today)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .map((warbond) => {
      shown.add(keyOf("warbonds", warbond.id));
      const items = warbondItems(warbond, catalog);
      const debuts = warbondDebuts(warbond, items, catalog, released);
      for (const { collection, entity } of [...items, ...debuts]) {
        shown.add(keyOf(collection, entity.id));
      }
      return { warbond, items, debuts };
    });

  const order = Object.keys(LABELS);
  const announced = [...catalog.values()].filter(({ collection, entity }) => {
    if (shown.has(keyOf(collection, entity.id))) return false;
    return entity.upcoming || (collection === "warbonds" && entity.releaseDate > today);
  });
  // A passive or trait is never flagged upcoming itself: it comes with the announced warbond.
  const announcedKeys = new Set(
    announced.map(({ collection, entity }) => keyOf(collection, entity.id)),
  );
  for (const { collection, entity } of announced) {
    if (collection !== "warbonds") continue;
    for (const debut of warbondDebuts(entity, warbondItems(entity, catalog), catalog, released)) {
      const key = keyOf(debut.collection, debut.entity.id);
      if (shown.has(key) || announcedKeys.has(key)) continue;
      announcedKeys.add(key);
      announced.push(debut);
    }
  }
  const upcoming = announced.sort(
    (a, b) =>
      order.indexOf(a.collection) - order.indexOf(b.collection) ||
      a.entity.name.localeCompare(b.entity.name),
  );
  for (const { collection, entity } of upcoming) shown.add(keyOf(collection, entity.id));

  // The changelog is newest first, so an item added twice keeps its latest date.
  const added = [];
  for (const entry of changelog) {
    if (entry.date < since || entry.date <= IMPORTED_UNTIL) continue;
    for (const change of entry.changes) {
      const key = keyOf(change.collection, change.id);
      if (change.kind !== "added" || shown.has(key) || !catalog.has(key)) continue;
      shown.add(key);
      added.push({ ...catalog.get(key), date: entry.date });
    }
  }

  return { warbonds, upcoming, added };
}

// --- Page -------------------------------------------------------------------------------------

// app.js, loaded on every page, already holds `status` and `showError` at the top level.
const statusLine = document.getElementById("new-status");
const grid = (id) => document.querySelector(`#${id} [data-cards]`);

function render({ warbonds, upcoming, added }, today) {
  grid("upcoming").replaceChildren(
    ...upcoming.map(({ collection, entity, carriers }) =>
      card(collection, entity, {
        tags: [
          tag("Coming soon", "accent"),
          carriers && tag(collection === "passives" ? "New passive" : "New trait", "accent"),
          collection === "warbonds" &&
            entity.releaseDate >= today &&
            tag(`Out ${entity.releaseDate}`),
        ].filter(Boolean),
        foot: carriers
          ? `With ${carriers.join(", ")}`
          : sourceLine(entity.source ?? entity.variants?.[0]?.source),
      }),
    ),
  );
  if (upcoming.length === 0) grid("upcoming").append(empty("Nothing announced right now."));

  grid("warbonds").replaceChildren(
    ...warbonds.map(({ warbond, items, debuts }) =>
      h(
        "section",
        { class: "stack new-warbond", "aria-label": warbond.name },
        h("h3", { class: "new-warbond-title" }, `${warbond.name} · ${warbond.releaseDate}`),
        h(
          "div",
          { class: "ex-grid" },
          card("warbonds", warbond, { stats: warbondStats(warbond, items) }),
          items.map(({ collection, entity, page, cost }) =>
            card(collection, entity, {
              foot: [`Page ${page}`, formatCost(cost)].filter(Boolean).join(" · "),
            }),
          ),
          debuts.map(({ collection, entity, carriers }) =>
            card(collection, entity, {
              tags: [tag(collection === "passives" ? "New passive" : "New trait", "accent")],
              foot: `With ${carriers.join(", ")}`,
            }),
          ),
        ),
      ),
    ),
  );
  if (warbonds.length === 0)
    grid("warbonds").append(empty("No warbond came out in these 30 days."));

  grid("added").replaceChildren(
    ...added.map(({ collection, entity, date }) =>
      card(collection, entity, {
        tags: [tag(`Added ${date}`)],
        foot: sourceLine(entity.source ?? entity.variants?.[0]?.source),
      }),
    ),
  );
  if (added.length === 0) grid("added").append(empty("Nothing new in the changelog."));
}

function showFailure(message) {
  const retry = h("button", { class: "icon-btn", type: "button" }, "Try again");
  retry.addEventListener("click", load);
  statusLine.replaceChildren(
    h(
      "p",
      { class: "alert", role: "alert" },
      h("span", { class: "alert-title" }, "! Could not load"),
      h("span", { class: "micro select-all" }, ` ${message} `),
      retry,
    ),
  );
}

async function get(path) {
  const response = await fetch(`/v1${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} · GET /v1${path}`);
  return response.json();
}

async function load() {
  statusLine.replaceChildren(h("span", { class: "terminal-cursor" }, "Fetching"));
  const today = day(Date.now());
  const since = day(Date.now() - WINDOW_DAYS * 86_400_000);
  try {
    const [all, changelog] = await Promise.all([get("/all.json"), get("/changelog.json")]);
    const found = whatsNew(all.data, changelog.data, today, since);
    render(found, today);
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const items = found.warbonds.flatMap(({ items }) => items).length;
    const debuts = found.warbonds.flatMap(({ debuts }) => debuts);
    const passives = debuts.filter(({ collection }) => collection === "passives").length;
    const extras = [
      passives > 0 && count(passives, "new passive"),
      debuts.length > passives && count(debuts.length - passives, "new trait"),
    ].filter(Boolean);
    statusLine.replaceChildren(
      tag("Live", "success"),
      ` since ${since} · ${found.upcoming.length} announced · ` +
        `${count(found.warbonds.length, "warbond")} (${[count(items, "item"), ...extras].join(", ")}) · ` +
        `${found.added.length} added · data ${all.meta.dataVersion}`,
    );
  } catch (error) {
    showFailure(error instanceof Error ? error.message : "request failed");
  }
}

load();
