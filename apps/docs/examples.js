// Examples page: five items of every collection, fetched from the static files while the page
// loads and laid out like any site would. `Show requests` reveals, per section, the code (static,
// in examples.html), every request it made and the response that came back. Each loader below is
// the snippet next to its section, run for real. No framework, no dependency.

/** The response headers worth showing a newcomer (caching and the dataset version). */
const SHOWN_HEADERS = ["content-type", "cache-control", "etag", "x-data-version"];

const number = new Intl.NumberFormat("en-US");

// --- Requests ---------------------------------------------------------------------------------

/** url → one request; a URL two cards ask for is fetched once and shared. */
const requests = new Map();

function request(url) {
  let entry = requests.get(url);
  if (entry) return entry;
  entry = { url, status: null, ms: null, bytes: 0, headers: [], text: null, error: null };
  entry.done = (async () => {
    const started = performance.now();
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      entry.text = await response.text();
      entry.status = response.status;
      entry.headers = SHOWN_HEADERS.map((name) => [name, response.headers.get(name)]).filter(
        ([, value]) => value,
      );
    } catch (error) {
      entry.error = error instanceof Error ? error.message : "request failed";
    }
    entry.ms = Math.round(performance.now() - started);
    entry.bytes = entry.text === null ? 0 : new TextEncoder().encode(entry.text).length;
    return entry;
  })();
  requests.set(url, entry);
  return entry;
}

/** The `get` of the snippets, recording which section and which card asked for what. */
function recorder(section, cardUrls) {
  return async (path) => {
    const url = `/v1${path}`;
    const entry = request(url);
    if (!section.urls.includes(url)) section.urls.push(url);
    if (!cardUrls.includes(url)) {
      cardUrls.push(url);
      section.uses.set(url, (section.uses.get(url) ?? 0) + 1);
    }
    await entry.done;
    if (entry.error) throw new Error(`${entry.error} · GET ${url}`);
    if (entry.status !== 200) throw new Error(`HTTP ${entry.status} · GET ${url}`);
    return JSON.parse(entry.text).data;
  };
}

// --- Formatting -------------------------------------------------------------------------------

const ROMAN = /^(i|ii|iii|iv|v|vi)$/;

/** `assault_rifle` → `Assault rifle`, `anti_tank_iii` → `Anti tank III`. Enums are open. */
function humanize(value) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .split(/[_-]+/)
    .map((word) => (ROMAN.test(word) ? word.toUpperCase() : word))
    .join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatCost(cost) {
  if (!cost) return null;
  if (cost.amount === 0) return "Free";
  const amount = number.format(cost.amount);
  switch (cost.currency) {
    case "medals":
      return `${amount} medals`;
    case "super_credits":
      return `${amount} Super Credits`;
    case "requisition":
      return `${amount} Requisition Slips`;
    case "usd":
      return `US$ ${amount}`;
    default:
      return `${amount} ${humanize(cost.currency)}`;
  }
}

/** Parts bought with one currency add up; otherwise each cost is listed. */
function formatTotal(costs) {
  const known = costs.filter(Boolean);
  if (known.length === 0) return null;
  const currencies = new Set(known.map((cost) => cost.currency));
  if (currencies.size > 1) return known.map(formatCost).join(" + ");
  const amount = known.reduce((sum, cost) => sum + cost.amount, 0);
  return formatCost({ currency: known[0].currency, amount });
}

/** `Hangar · 10,000 Requisition Slips`; a label the cost already says is not repeated. */
function sourceLine(source) {
  if (!source) return null;
  const cost = formatCost(source.cost);
  if (cost?.includes(source.label)) return cost;
  return [source.label, cost].filter(Boolean).join(" · ");
}

const seconds = (value) => (value === null || value === undefined ? null : `${value} s`);

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

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

function image(item, alt = "") {
  if (!item?.url) return h("span", { class: "micro" }, "No image");
  return h("img", {
    src: item.url,
    width: item.width,
    height: item.height,
    alt,
    loading: "lazy",
    decoding: "async",
  });
}

const media = (item, kind = "wide") =>
  h("figure", { class: `ex-media${kind === "wide" ? "" : ` ex-media-${kind}`}` }, image(item));

/** The card every section renders: a frame, a picture, a name and what matters about it. */
function card({ bar, picture, name, lines = [], stats = [], tags = [], foot = null }) {
  const shownStats = stats.filter(([, value]) => value !== null && value !== undefined);
  return h(
    "article",
    { class: "panel ex-card" },
    windowBar(bar),
    picture,
    h(
      "div",
      { class: "ex-body" },
      h("h3", { class: "ex-name" }, name),
      lines,
      shownStats.length > 0 &&
        h(
          "dl",
          { class: "ex-stats" },
          shownStats.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))),
        ),
      tags.length > 0 &&
        h(
          "p",
          { class: "ex-tags" },
          tags.map((tag) => h("span", { class: "tag tag-muted" }, tag)),
        ),
      foot && h("p", { class: "micro ex-foot" }, foot),
    ),
  );
}

// --- Sections: the snippet of each section in examples.html, run for real ---------------------

const SECTIONS = {
  "armor-sets": {
    picks: [
      "sc-34-infiltrator",
      "a-9-helljumper",
      "tg-8-sharpshooter",
      "ex-00-prototype-x",
      "fs-55-devastator",
    ],
    async load(get, id) {
      const set = await get(`/armor-sets/${id}.json`);
      const [armor, helmet, cape] = await Promise.all([
        get(`/armors/${set.armorId}.json`),
        get(`/helmets/${set.helmetId}.json`),
        get(`/capes/${set.capeId}.json`),
      ]);
      const passive = await get(`/passives/${armor.passiveId}.json`);
      return { set, armor, helmet, cape, passive };
    },
    render({ set, armor, helmet, cape, passive }) {
      const part = (label, item) =>
        h(
          "figure",
          {},
          image(item.image, `${label}: ${item.name}`),
          h("figcaption", { class: "micro" }, label),
        );
      return card({
        bar: `${armor.weight} armor`,
        picture: h(
          "div",
          { class: "ex-media ex-trio" },
          part("Helmet", helmet),
          part("Armor", armor),
          part("Cape", cape),
        ),
        name: set.name,
        lines: [
          h("p", {}, h("strong", {}, passive.name), " — ", passive.description),
          h("p", { class: "hint" }, `Cape: ${cape.name}`),
        ],
        stats: [
          ["Armor", armor.armorRating],
          ["Speed", armor.speed],
          ["Stamina regen", armor.staminaRegen],
        ],
        foot: [
          armor.source?.label,
          formatTotal([helmet.source?.cost, armor.source?.cost, cape.source?.cost]),
        ]
          .filter(Boolean)
          .join(" · "),
      });
    },
  },

  weapons: {
    picks: [
      "ar-23-liberator",
      "sg-225-breaker",
      "plas-1-scorcher",
      "p-4-senator",
      "g-12-high-explosive",
    ],
    async load(get, id) {
      const weapon = await get(`/weapons/${id}.json`);
      const traits = await Promise.all(
        weapon.traitIds.map((trait) => get(`/weapon-traits/${trait}.json`)),
      );
      return { weapon, traits };
    },
    render({ weapon, traits }) {
      const attack = weapon.attacks?.[0];
      const { firearm, throwable } = weapon;
      return card({
        bar: `${weapon.category} weapon`,
        picture: media(weapon.image),
        name: weapon.name,
        stats: [
          ["Type", humanize(weapon.subcategory)],
          ["Damage", attack?.damage?.standard],
          ["Penetration", humanize(attack?.penetration?.direct)],
          ["Fire rate", firearm?.fireRateRpm?.[0] ? `${firearm.fireRateRpm[0]} rpm` : null],
          ["Magazine", firearm?.capacity],
          ["Reload", seconds(firearm?.reloadTimeS)],
          ["Carry", throwable?.capacity],
          ["Fuse", seconds(throwable?.fuseTimeS)],
        ],
        tags: traits.map((trait) => trait.name),
        foot: sourceLine(weapon.source),
      });
    },
  },

  stratagems: {
    picks: [
      "eagle-500kg-bomb",
      "orbital-railcannon-strike",
      "las-99-quasar-cannon",
      "a-mg-43-machine-gun-sentry",
      "b-1-supply-pack",
    ],
    load: (get, id) => get(`/stratagems/${id}.json`),
    render(stratagem) {
      const code = stratagem.code ?? [];
      return card({
        bar: humanize(stratagem.kind) ?? "Stratagem",
        picture: media(stratagem.image, "icon"),
        name: stratagem.name,
        lines: [
          h(
            "p",
            { class: "ex-code", "aria-label": `Code: ${code.join(", ")}` },
            code.map((direction) =>
              h("span", { class: "ex-arrow", "data-dir": direction, "aria-hidden": "true" }, "↑"),
            ),
          ),
        ],
        stats: [
          ["Cooldown", seconds(stratagem.cooldownS)],
          ["Call-in", seconds(stratagem.callInTimeS)],
          ["Uses", humanize(stratagem.uses)],
          ["Unlock", stratagem.unlockLevel ? `Level ${stratagem.unlockLevel}` : null],
        ],
        tags: [humanize(stratagem.permitType)].filter(Boolean),
        foot: sourceLine(stratagem.source),
      });
    },
  },

  warbonds: {
    picks: [
      "helldivers-mobilize",
      "cutting-edge",
      "polar-patriots",
      "freedoms-flame",
      "castellans-creed",
    ],
    load: (get, id) => get(`/warbonds/${id}.json`),
    render(warbond) {
      const items = (warbond.pages ?? []).flatMap((page) => page.items);
      return card({
        bar: `${warbond.type} warbond`,
        picture: media(warbond.image),
        name: warbond.name,
        stats: [
          ["Released", warbond.releaseDate],
          ["Price", formatCost(warbond.cost)],
          ["Pages", warbond.pages?.length],
          ["Items", items.length],
          ["Medals for all", warbond.medalsAllItems ? number.format(warbond.medalsAllItems) : null],
        ],
      });
    },
  },

  boosters: {
    picks: [
      "vitality-enhancement",
      "stamina-enhancement",
      "muscle-enhancement",
      "hellpod-space-optimization",
      "uav-recon-booster",
    ],
    async load(get, id) {
      const boosters = await get("/boosters.json");
      return found(
        boosters.find((booster) => booster.id === id),
        `${id} is not in /v1/boosters.json`,
      );
    },
    render(booster) {
      return card({
        bar: "Booster",
        picture: media(booster.image, "icon"),
        name: booster.name,
        lines: [h("p", {}, booster.effect)],
        foot: sourceLine(booster.source),
      });
    },
  },

  "player-cards": {
    picks: [0, 1, 2, 3, 4],
    async load(get, index) {
      const cards = await get("/player-cards/by-warbond/helldivers-mobilize.json");
      return found(cards[index], `the facet has fewer than ${index + 1} cards`);
    },
    render(playerCard) {
      return card({
        bar: "Player card",
        picture: media(playerCard.image, "tall"),
        name: playerCard.name,
        foot: sourceLine(playerCard.source),
      });
    },
  },

  emotes: {
    picks: [0, 1, 2, 3, 4],
    async load(get, index) {
      const poses = await get("/emotes/by-kind/victory-pose.json");
      return found(poses[index], `the facet has fewer than ${index + 1} poses`);
    },
    render(emote) {
      return card({
        bar: "Emote",
        picture: media(emote.image, "icon"),
        name: emote.name,
        tags: [emote.emote && "Emote", emote.victoryPose && "Victory pose"].filter(Boolean),
        foot: sourceLine(emote.source),
      });
    },
  },

  patterns: {
    picks: [0, 1, 2, 3, 4],
    async load(get, index) {
      const patterns = await get("/patterns/by-scope/weapon.json");
      return found(patterns[index], `the facet has fewer than ${index + 1} patterns`);
    },
    render(pattern) {
      const variant = pattern.variants?.[0];
      return card({
        bar: `${pattern.scope} pattern`,
        picture: media(variant?.image ?? pattern.image),
        name: pattern.name,
        stats: [["Unlock", pattern.unlockLevel ? `Level ${pattern.unlockLevel}` : null]],
        foot: sourceLine(variant?.source),
      });
    },
  },

  titles: {
    picks: [0, 1, 2, 3, 4],
    async load(get, index) {
      const ranks = await get("/titles/by-kind/rank.json");
      const sorted = [...ranks].sort((a, b) => a.levelEarned - b.levelEarned);
      return found(sorted[index], `the facet has fewer than ${index + 1} ranks`);
    },
    render(title) {
      return card({
        bar: `${title.kind} title`,
        picture: media(title.image, "icon"),
        name: title.name,
        stats: [["Earned at", title.levelEarned ? `Level ${title.levelEarned}` : null]],
      });
    },
  },
};

function found(item, message) {
  if (item === undefined) throw new Error(message);
  return item;
}

// --- Cards and the request log ----------------------------------------------------------------

const loadingCard = () =>
  h(
    "article",
    { class: "panel ex-card", "aria-busy": "true" },
    windowBar("GET"),
    h("div", { class: "ex-body" }, h("p", { class: "micro terminal-cursor" }, "Fetching")),
  );

function errorCard(error) {
  return h(
    "article",
    { class: "panel ex-card" },
    windowBar("Error"),
    h(
      "div",
      { class: "ex-body" },
      h(
        "p",
        { class: "alert", role: "alert" },
        h("span", { class: "alert-title" }, "! Could not load"),
        h("br"),
        h("span", { class: "micro select-all" }, error instanceof Error ? error.message : "failed"),
      ),
    ),
  );
}

/** Revealed with the requests: the URLs this one card was built from. */
const cardRequests = (urls) =>
  h(
    "div",
    { class: "req ex-card-req" },
    h(
      "span",
      { class: "micro" },
      `Built from ${urls.length} request${urls.length === 1 ? "" : "s"}`,
    ),
    h(
      "ul",
      {},
      urls.map((url) => h("li", {}, h("a", { href: url }, `GET ${url}`))),
    ),
  );

function statusTag(entry) {
  if (entry.status === null && entry.error === null) {
    return h("span", { class: "tag tag-muted" }, "…");
  }
  const ok = entry.status === 200;
  return h("span", { class: `tag ${ok ? "tag-success" : "tag-error"}` }, entry.status ?? "ERR");
}

/** Pretty JSON, filled on first open: some bodies are long and most rows stay closed. */
function responseBody(entry) {
  let pretty = entry.text ?? entry.error ?? "";
  try {
    pretty = JSON.stringify(JSON.parse(pretty), null, 2);
  } catch {
    // Not JSON (an error page): shown as it came.
  }
  return h(
    "div",
    { class: "ex-response" },
    entry.headers.length > 0 &&
      h(
        "dl",
        { class: "ex-headers" },
        entry.headers.map(([name, value]) =>
          h("div", {}, h("dt", {}, `${name}:`), h("dd", {}, value)),
        ),
      ),
    h("pre", {}, h("code", {}, pretty)),
    h("p", {}, h("a", { class: "icon-btn", href: entry.url }, "Open raw")),
  );
}

function logRow(entry, uses) {
  const details = h(
    "details",
    {},
    h(
      "summary",
      {},
      statusTag(entry),
      h("code", {}, `GET ${entry.url}`),
      entry.ms !== null &&
        h("span", { class: "micro" }, `${entry.ms} ms · ${kilobytes(entry.bytes)}`),
      uses > 1 && h("span", { class: "tag tag-muted" }, `shared by ${uses} cards`),
    ),
  );
  details.addEventListener("toggle", () => {
    if (details.open && details.childElementCount === 1) details.append(responseBody(entry));
  });
  return h("li", {}, details);
}

function renderLog(section, container) {
  const entries = section.urls.map((url) => requests.get(url));
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const label =
    entries.length === 0
      ? "Requests"
      : `${entries.length} request${entries.length === 1 ? "" : "s"} · ${kilobytes(bytes)}`;
  container.replaceChildren(
    h(
      "div",
      { class: "stack" },
      h("p", { class: "section-label" }, h("span", { class: "sigil" }, ">"), ` ${label}`),
      entries.length > 0 &&
        h(
          "ol",
          { class: "ex-log" },
          entries.map((entry) => logRow(entry, section.uses.get(entry.url) ?? 0)),
        ),
      h(
        "p",
        { class: "hint" },
        "In the order the page asked. Open one to see its headers and body; sizes are before compression.",
      ),
    ),
  );
}

async function runSection(node) {
  const config = SECTIONS[node.id];
  if (!config) return;
  const section = { urls: [], uses: new Map() };
  const grid = node.querySelector("[data-cards]");
  const log = node.querySelector("[data-log]");
  const slots = config.picks.map(loadingCard);
  grid.replaceChildren(...slots);
  renderLog(section, log);

  await Promise.all(
    config.picks.map(async (pick, index) => {
      const urls = [];
      let built;
      try {
        built = config.render(await config.load(recorder(section, urls), pick));
      } catch (error) {
        built = errorCard(error);
      }
      built.append(cardRequests(urls));
      slots[index].replaceWith(built);
    }),
  );
  renderLog(section, log);
}

// --- Page -------------------------------------------------------------------------------------

/** The section being read, once the hero is scrolled away: toggling brings its top back. */
function sectionInView() {
  const barBottom = document.querySelector(".ex-bar").getBoundingClientRect().bottom;
  if (document.querySelector(".hero").getBoundingClientRect().bottom > barBottom) return null;
  return [...document.querySelectorAll("[data-example]")].find(
    (section) => section.getBoundingClientRect().bottom > barBottom + 1,
  );
}

function setReveal(on) {
  const anchor = sectionInView();
  document.body.classList.toggle("ex-reveal", on);
  for (const button of document.querySelectorAll("[data-reveal]")) {
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Hide requests" : "Show requests";
  }
  // Without this the panels open above the reader and push what they were looking at away.
  anchor?.scrollIntoView({ block: "start" });
}

for (const button of document.querySelectorAll("[data-reveal]")) {
  button.addEventListener("click", () => setReveal(!document.body.classList.contains("ex-reveal")));
}

function showTotals() {
  const status = document.getElementById("ex-status");
  const entries = [...requests.values()];
  const failed = entries.filter((entry) => entry.status !== 200).length;
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const version = entries
    .flatMap((entry) => entry.headers)
    .find(([name]) => name === "x-data-version")?.[1];
  const badge = h(
    "span",
    { class: `tag ${failed === 0 ? "tag-success" : "tag-error"}` },
    failed === 0 ? "Live" : `${failed} failed`,
  );
  status.replaceChildren(
    badge,
    ` ${entries.length} requests · ${kilobytes(bytes)} · all static files`,
    version ? ` · data ${version}` : "",
  );
}

Promise.all([...document.querySelectorAll("[data-example]")].map(runSection)).then(showTotals);
