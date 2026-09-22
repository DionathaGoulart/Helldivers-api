// Scalar API Reference, skinned with the site tokens (styleguide §4.1–§4.3, arch §9).
// Scalar keeps two variable sets (`.light-mode` / `.dark-mode`); both are mapped to the same
// semantic tokens, which already flip with `data-theme` on <html>, so its own toggle is hidden
// and the site toggle (Shift+T) drives the reference too.

const customCss = `
  .light-mode, .dark-mode {
    --scalar-font: var(--font-mono);
    --scalar-font-code: var(--font-mono);
    --scalar-background-1: var(--base-100);
    --scalar-background-2: var(--base-200);
    --scalar-background-3: var(--base-200);
    --scalar-background-card: var(--base-200);
    --scalar-background-accent: var(--accent);
    --scalar-color-1: var(--base-content);
    --scalar-color-2: var(--base-content);
    --scalar-color-3: var(--muted-text);
    --scalar-color-disabled: var(--muted-text);
    --scalar-color-ghost: var(--muted-text);
    --scalar-color-accent: var(--accent-text);
    --scalar-border-color: var(--base-300);
    --scalar-button-1: var(--accent);
    --scalar-button-1-color: var(--accent-content);
    --scalar-button-1-hover: var(--accent);
    --scalar-color-green: var(--success-text);
    --scalar-color-red: var(--error-text);
    --scalar-color-yellow: var(--warning-text);
    --scalar-color-blue: var(--info-text);
    --scalar-color-orange: var(--warning-text);
    --scalar-color-purple: var(--accent-text);
    --scalar-sidebar-background-1: var(--base-100);
    --scalar-sidebar-color-1: var(--base-content);
    --scalar-sidebar-color-2: var(--muted-text);
    --scalar-sidebar-border-color: var(--base-300);
    --scalar-sidebar-item-hover-background: var(--base-200);
    --scalar-sidebar-item-hover-color: var(--base-content);
    --scalar-sidebar-item-active-background: var(--accent);
    --scalar-sidebar-color-active: var(--accent-content);
    --scalar-sidebar-search-background: var(--base-200);
    --scalar-sidebar-search-border-color: var(--base-300);
    --scalar-sidebar-search-color: var(--base-content);
    /* §4.3: zero radius everywhere, including Scalar's own scale. */
    --scalar-radius: 0;
    --scalar-radius-lg: 0;
    --scalar-radius-xl: 0;
    --scalar-border-width: 2px;
    --scalar-shadow-1: 3px 3px 0 0 var(--shadow);
    --scalar-shadow-2: 6px 6px 0 0 var(--shadow);
  }

  .scalar-app, .scalar-api-reference {
    font-family: var(--font-mono);
  }

  /* §4.2/§4.3: frames are 2px and square, never a soft rounded card. */
  .scalar-app .scalar-card,
  .scalar-app .scalar-panel,
  .scalar-app button,
  .scalar-app input,
  .scalar-app select,
  .scalar-app textarea {
    border-radius: 0;
  }

  /* §4.12: the focus ring is the site ring, solid and 2px. */
  .scalar-app :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .scalar-app *, .scalar-app *::before, .scalar-app *::after {
      animation: none !important;
      transition: none !important;
    }
  }
`;

const loading = document.getElementById("reference-loading");

function showFailure() {
  if (!loading) return;
  loading.classList.remove("terminal-cursor");
  loading.innerHTML = "";
  const banner = document.createElement("p");
  banner.className = "alert";
  banner.setAttribute("role", "alert");
  const title = document.createElement("span");
  title.className = "alert-title";
  title.textContent = "! Reference unavailable";
  const body = document.createElement("span");
  body.className = "micro";
  body.textContent = " The renderer did not load. The document itself is at ";
  const link = document.createElement("a");
  link.href = "/v1/openapi.json";
  link.textContent = "/v1/openapi.json";
  banner.append(title, body, link);
  loading.replaceWith(banner);
}

if (typeof Scalar === "undefined") {
  showFailure();
} else {
  Scalar.createApiReference("#scalar", {
    url: "/v1/openapi.json",
    customCss,
    hideDarkModeToggle: true,
    hideClientButton: true,
    darkMode: document.documentElement.dataset.theme !== "yellow",
    metaData: { title: "Helldivers 2 Data API reference" },
  });
  loading?.remove();
}
