// Docs site behaviour: the theme toggle (styleguide §0.3) and the live dataset numbers on the
// landing page (§4.5 loading caret, §8 error banner). No framework, no dependency: the pages are
// readable without it, this only fills in what the dataset knows.

const THEME_KEY = "hd2api-theme";
const THEMES = ["yellow", "black"];

const root = document.documentElement;

function currentTheme() {
  return THEMES.includes(root.dataset.theme) ? root.dataset.theme : "black";
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  const other = theme === "black" ? "yellow" : "black";
  const name = button.querySelector("#theme-name");
  if (name) name.textContent = theme;
  button.setAttribute("aria-label", `Theme ${theme}. Switch to ${other} (Shift+T)`);
}

function toggleTheme() {
  applyTheme(currentTheme() === "black" ? "yellow" : "black");
}

applyTheme(currentTheme());
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
  const shortcut = event.shiftKey && event.key.toUpperCase() === "T";
  if (shortcut && !event.ctrlKey && !event.metaKey && !typing) {
    toggleTheme();
  }
});

// --- Landing page: counts and freshness from /v1/meta.json -------------------------------------

const status = document.getElementById("status");

const formatDate = (iso) =>
  new Date(iso)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");

function showDataset(manifest) {
  let total = 0;
  for (const [collection, entry] of Object.entries(manifest.collections ?? {})) {
    total += entry.count;
    const count = document.querySelector(`[data-collection="${collection}"] [data-count]`);
    if (count) count.textContent = String(entry.count);
  }
  status.textContent = "";
  const badge = document.createElement("span");
  badge.className = "tag tag-success";
  badge.textContent = "Online";
  status.append(
    badge,
    ` ${total} items · data ${manifest.dataVersion} · built ${formatDate(manifest.generatedAt)}`,
  );
}

function showError(detail, requestId) {
  status.textContent = "";
  const banner = document.createElement("p");
  banner.className = "alert";
  banner.setAttribute("role", "alert");
  const title = document.createElement("span");
  title.className = "alert-title";
  title.textContent = "! Dataset unavailable";
  const body = document.createElement("span");
  body.className = "micro select-all";
  body.textContent = requestId ? ` ${detail} · request ${requestId}` : ` ${detail}`;
  const retry = document.createElement("button");
  retry.className = "icon-btn";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", loadDataset);
  banner.append(title, body, " ", retry);
  status.append(banner);
}

async function loadDataset() {
  if (!status) return;
  status.textContent = "";
  const loading = document.createElement("span");
  loading.className = "terminal-cursor";
  loading.textContent = "Loading dataset";
  status.append(loading);
  try {
    const response = await fetch("/v1/meta.json", { headers: { Accept: "application/json" } });
    // Cloudflare names every request; it is what support needs to find this one in the logs.
    const requestId = response.headers.get("cf-ray");
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { requestId });
    showDataset(await response.json());
  } catch (error) {
    showError(error instanceof Error ? error.message : "request failed", error?.requestId ?? null);
  }
}

loadDataset();
