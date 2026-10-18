import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";

// Must match the repo the backend checks and the installer script downloads from.
const GITHUB_REPO = "Noctillio-Ai/NightFlow";
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DISMISSED_KEY = "nightflow_update_dismissed";

/** @type {import("@preact/signals").Signal<string|null>} */
export const latestVersion = signal(null);

/** @type {import("@preact/signals").Signal<string|null>} */
export const currentVersion = signal(null);

/** @type {import("@preact/signals").Signal<boolean>} */
export const updateAvailable = signal(false);

/** @type {import("@preact/signals").Signal<string|null>} */
export const releaseUrl = signal(null);

/** @type {import("@preact/signals").Signal<boolean>} */
export const updateDismissed = signal(false);

/** @type {import("@preact/signals").Signal<boolean>} */
export const updateInstalling = signal(false);

/** @type {import("@preact/signals").Signal<string|null>} */
export const updateError = signal(null);

/**
 * Compare two semver strings. Returns true if remote > local.
 */
function isNewer(remote, local) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const r = parse(remote);
  const l = parse(local);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

export async function checkForUpdate() {
  try {
    // The backend queries GitHub with curl, so this isn't subject to webview CSP/CORS.
    const info = await invoke("check_for_update");
    currentVersion.value = info.current;
    latestVersion.value = info.latest;
    const tag = `v${info.latest}`;
    releaseUrl.value = `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === tag) {
      updateDismissed.value = true;
      updateAvailable.value = false;
      return;
    }

    updateAvailable.value = isNewer(info.latest, info.current);
    updateDismissed.value = false;
  } catch {
    // Silently fail — no network, rate-limited, etc.
  }
}

/**
 * Run the bundled installer script for the latest release. On success the
 * backend quits the app; the script replaces it and relaunches.
 */
export async function installUpdate() {
  if (updateInstalling.value) return;
  updateInstalling.value = true;
  updateError.value = null;
  try {
    await invoke("install_update", { version: latestVersion.value });
  } catch (e) {
    updateError.value = String(e);
    updateInstalling.value = false;
  }
}

export function dismissUpdate() {
  if (latestVersion.value) {
    localStorage.setItem(DISMISSED_KEY, `v${latestVersion.value}`);
  }
  updateDismissed.value = true;
  updateAvailable.value = false;
}

let intervalId = null;

export function startUpdateChecker() {
  checkForUpdate();
  intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
}

export function stopUpdateChecker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
