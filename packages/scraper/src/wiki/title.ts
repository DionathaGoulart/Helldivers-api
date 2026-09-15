// Page titles ⇄ wiki paths. Titles use spaces; paths use underscores (MediaWiki).

export const WIKI_ORIGIN = "https://helldivers.wiki.gg";

/** `Boosters_` / `  Boosters ` → `Boosters`. */
export function normalizeTitle(title: string): string {
  return title.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

/** `City Fighter's Resolve` → `/wiki/City_Fighter's_Resolve` (apostrophes stay, arch §5.4). */
export function titleToPath(title: string): string {
  const encoded = encodeURI(normalizeTitle(title).replaceAll(" ", "_"))
    .replaceAll("?", "%3F")
    .replaceAll("#", "%23");
  return `/wiki/${encoded}`;
}

export function wikiUrl(title: string, anchor: string | null = null): string {
  return `${WIKI_ORIGIN}${titleToPath(title)}${anchor ? `#${encodeURI(anchor)}` : ""}`;
}

export interface WikiLink {
  title: string;
  anchor: string | null; // "Page_3"
}

/**
 * Target of an article link (`/wiki/Helldivers_Mobilize_Warbond#Page_3` or the same on
 * the wiki host). Red links (`/index.php?title=…&redlink=1`) and other hosts give null.
 */
export function linkFromHref(href: string): WikiLink | null {
  let url: URL;
  try {
    url = new URL(href, WIKI_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== WIKI_ORIGIN || !url.pathname.startsWith("/wiki/") || url.search !== "") {
    return null;
  }
  const title = normalizeTitle(decodeURIComponent(url.pathname.slice("/wiki/".length)));
  if (!title) {
    return null;
  }
  const anchor = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
  return { title, anchor: anchor || null };
}

/** Fixture file of a page: `R/40-K Hot-Shot Marksman Rifle` → `R%2F40-K_Hot-Shot_Marksman_Rifle.html`. */
export function fixtureFileName(title: string): string {
  return `${encodeURIComponent(normalizeTitle(title).replaceAll(" ", "_"))}.html`;
}
