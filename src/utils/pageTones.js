// Accent hue for each page. The app shell exposes the current page's hue as
// --app-tone (see polish.css), which tints the sidebar, header, cards, focus
// rings and primary buttons. Status colours (--tone, --dash-ok/warn/err) are
// separate and never overridden by this.

export const PAGE_TONES = {
  dashboard: "#818cf8",
  experiments: "#f472b6",
  "run-detail": "#f472b6",
  "compare-runs": "#c084fc",
  "deploy-model": "#fb923c",
  "dataset-browser": "#fbbf24",
  interpretation: "#34d399",
  netron: "#38bdf8",
  terminal: "#2dd4bf",
  settings: "#818cf8",
};

export const pageTone = (page) => PAGE_TONES[page] || PAGE_TONES.dashboard;
