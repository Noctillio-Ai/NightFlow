import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { theme, toggleTheme } from "../state/theme.js";
import { currentPage, routeParams, navigate } from "../state/router.js";
import { allRuns } from "../state/experiments.js";
import { shortcutsOpen } from "../app.jsx";
import { currentProject } from "../state/projects.js";
import { platform } from "../state/dashboard.js";
import { useState } from "preact/hooks";
import { anyTrainingActive } from "../state/training.js";
import {
  updateAvailable,
  latestVersion,
  releaseUrl,
  dismissUpdate,
  installUpdate,
  updateInstalling,
  updateError,
} from "../state/update.js";

const titles = {
  dashboard: "Dashboard",
  experiments: "Experiments",
  "dataset-browser": "Dataset Browser",
  interpretation: "Interpretation",
  netron: "Model Viewer",
  charts: "Charts",
  terminal: "Terminal",
  settings: "Project Settings",
  "run-detail": "Run Detail",
  "compare-runs": "Compare Runs",
};

const keyboardIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>`;

/** Breadcrumb trail for pages nested under Experiments, else null. */
function breadcrumbLeaf() {
  const page = currentPage.value;
  if (page === "run-detail") {
    const run = allRuns.value.find((r) => r.id === routeParams.value.runId);
    return run ? run.name || run.id : "Run";
  }
  if (page === "compare-runs") {
    const n = routeParams.value.runIds?.length || 0;
    return `Compare ${n} runs`;
  }
  return null;
}

const chevronSep = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const settingsIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--bg-primary)"/><circle cx="15" cy="17" r="2.5" fill="var(--bg-primary)"/></svg>`;

const sunIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const moonIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const minimizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor"/></svg>`;
const maximizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
const closeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/**
 * "vX available" pill. Update runs the bundled installer script (the app quits
 * and relaunches); if that fails, it falls back to the release page.
 */
function UpdateBadge() {
  const [confirming, setConfirming] = useState(false);
  const installing = updateInstalling.value;
  const error = updateError.value;

  const onUpdate = () => {
    // Updating quits the app, which would kill any running training job.
    if (anyTrainingActive.value && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    installUpdate();
  };

  let text = `v${latestVersion.value} available`;
  if (installing) text = `Installing v${latestVersion.value}…`;
  else if (error) text = "Update failed";
  else if (confirming) text = "Training will stop.";

  return (
    <div class={`update-badge${error ? " update-badge--error" : ""}`} title={error || undefined}>
      <span class="update-badge-dot" />
      <span class="update-badge-text">{text}</span>
      {error ? (
        <button class="update-badge-btn" onClick={() => openUrl(releaseUrl.value)}>
          Download
        </button>
      ) : (
        <button class="update-badge-btn" onClick={onUpdate} disabled={installing}>
          {installing ? "Updating…" : confirming ? "Update anyway" : "Update"}
        </button>
      )}
      {!installing && (
        <button
          class="update-badge-dismiss"
          onClick={confirming ? () => setConfirming(false) : dismissUpdate}
          title={confirming ? "Cancel" : "Dismiss"}
          aria-label={confirming ? "Cancel update" : "Dismiss update notice"}
        >
          &times;
        </button>
      )}
    </div>
  );
}

export function Header() {
  const isWindows = platform.value === "windows";
  const leaf = breadcrumbLeaf();
  const onDashboard = currentPage.value === "dashboard";

  return (
    <header class={`header ${isWindows ? "header--windows" : ""}`} data-tauri-drag-region>
      <div class="header-title-group">
        {leaf ? (
          <nav class="header-breadcrumb" aria-label="Breadcrumb">
            <button class="header-crumb" onClick={() => navigate("experiments")}>
              Experiments
            </button>
            <span class="header-crumb-sep" aria-hidden="true" dangerouslySetInnerHTML={{ __html: chevronSep }} />
            <h1 class="header-title header-title--leaf" title={leaf}>{leaf}</h1>
          </nav>
        ) : onDashboard && currentProject.value ? (
          <nav class="header-breadcrumb" aria-label="Breadcrumb">
            <h1 class="header-title">Dashboard</h1>
            <span class="header-crumb-sep" aria-hidden="true" dangerouslySetInnerHTML={{ __html: chevronSep }} />
            <span class="header-title header-title--leaf header-title--project" title={currentProject.value.name}>
              {currentProject.value.name}
            </span>
          </nav>
        ) : (
          <h1 class="header-title">{titles[currentPage.value] || "NightFlow"}</h1>
        )}
        {currentProject.value && !onDashboard && (
          <span class="header-project-badge">{currentProject.value.name}</span>
        )}
      </div>
      <div class="header-actions">
        {onDashboard && currentProject.value && (
          <button class="header-settings-btn" onClick={() => navigate("settings")}>
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: settingsIcon }} />
            Project settings
          </button>
        )}
        {updateAvailable.value && <UpdateBadge />}
        <button
          class="theme-toggle"
          onClick={() => (shortcutsOpen.value = true)}
          aria-label="Keyboard shortcuts"
          title={`Keyboard shortcuts (${navigator.platform.includes("Mac") ? "\u2318" : "Ctrl+"}K)`}
        >
          <span dangerouslySetInnerHTML={{ __html: keyboardIcon }} />
        </button>
        <button
          class="theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={theme.value === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <span
            dangerouslySetInnerHTML={{
              __html: theme.value === "dark" ? sunIcon : moonIcon,
            }}
          />
        </button>
        {isWindows && (
          <div class="win-controls">
            <button
              class="win-control-btn"
              onClick={() => invoke("window_minimize")}
              aria-label="Minimize"
            >
              <span dangerouslySetInnerHTML={{ __html: minimizeIcon }} />
            </button>
            <button
              class="win-control-btn"
              onClick={() => invoke("window_maximize")}
              aria-label="Maximize"
            >
              <span dangerouslySetInnerHTML={{ __html: maximizeIcon }} />
            </button>
            <button
              class="win-control-btn win-control-btn--close"
              onClick={() => invoke("window_close")}
              aria-label="Close"
            >
              <span dangerouslySetInnerHTML={{ __html: closeIcon }} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
