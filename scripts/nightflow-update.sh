#!/usr/bin/env bash
#
# nightflow-update.sh — download and install a NightFlow release from GitHub,
# on macOS or Linux. Used both for manual updates and for the in-app "Update"
# flow (the running app passes its own pid via --wait-pid).
#
# macOS: NightFlow is ad-hoc signed (not Apple-notarized), so the DMG arrives
# with a Gatekeeper quarantine flag that would block launch. This script clears
# that flag on the NightFlow bundle it just installed — the normal step for a
# self-distributed app. It touches nothing but the app it installed.
#
# Linux: installs the portable AppImage into ~/.local/bin (no root) with a
# desktop entry, or the .deb system package with --deb. There is no Gatekeeper;
# the only "unblock" an AppImage needs is the executable bit (chmod +x).
#
# Usage:
#   nightflow-update.sh [--version X.Y.Z] [--wait-pid PID] [--relaunch] [--deb] [--yes]
#
#   --version X.Y.Z   Install this exact version. Default: latest GitHub release.
#   --wait-pid PID    Wait for this process to exit before installing (used when
#                     the running app triggers its own update).
#   --relaunch        Open NightFlow again after a successful install.
#   --deb             Linux only: install the .deb package (needs sudo) instead
#                     of the AppImage.
#   --yes             Don't prompt for confirmation (non-interactive).
#
# Exit codes: 0 success, 1 usage/arg error, 2 network/asset error, 3 install error.

set -euo pipefail

# ---- Configuration ----------------------------------------------------------
REPO="${NIGHTFLOW_REPO:-Noctillio-Ai/NightFlow}"   # owner/repo that hosts releases
APP_NAME="NightFlow.app"
API="https://api.github.com/repos/${REPO}"

# ---- Args -------------------------------------------------------------------
VERSION=""
WAIT_PID=""
RELAUNCH=0
ASSUME_YES=0
USE_DEB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  VERSION="${2:?--version needs a value}"; shift 2 ;;
    --wait-pid) WAIT_PID="${2:?--wait-pid needs a value}"; shift 2 ;;
    --relaunch) RELAUNCH=1; shift ;;
    --deb)      USE_DEB=1; shift ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[nightflow-update]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[nightflow-update]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit "${2:-3}"; }

OS="$(uname -s)"
command -v curl >/dev/null || die "curl is required." 1

gh_get() {
  # Honor GITHUB_TOKEN if present (raises rate limit / allows private repos).
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" "$@"
  else
    curl -fsSL "$@"
  fi
}

# ---- Resolve version & tag --------------------------------------------------
if [[ -z "$VERSION" ]]; then
  log "Resolving latest release of ${REPO}…"
  TAG="$(gh_get "${API}/releases/latest" \
        | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')" \
        || die "Could not reach the GitHub API." 2
  [[ -n "$TAG" ]] || die "No releases found for ${REPO}." 2
  VERSION="${TAG#v}"
else
  TAG="v${VERSION#v}"
  VERSION="${VERSION#v}"
fi

log "Target version : ${VERSION} (${TAG})"

# ---- Shared helpers ---------------------------------------------------------

# Verify a download against its "<url>.sha256" sidecar, if the release ships one.
# $1 = local file path, $2 = download URL
verify_checksum() {
  local file="$1" url="$2" expected actual
  if gh_get -o "${file}.sha256" "${url}.sha256" 2>/dev/null; then
    expected="$(awk '{print $1}' "${file}.sha256")"
    actual="$(
      if command -v shasum >/dev/null; then shasum -a 256 "$file" | awk '{print $1}';
      else sha256sum "$file" | awk '{print $1}'; fi
    )"
    [[ "$expected" == "$actual" ]] \
      || die "Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}" 2
    log "Checksum OK (${actual})"
  else
    log "No published checksum; skipping verification."
  fi
}

confirm() {
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    printf 'Install NightFlow %s? [y/N] ' "$VERSION"
    read -r reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Cancelled." 1
  fi
}

# Wait for the app that triggered the update to quit, then make doubly sure no
# NightFlow process is still holding files. $@ = extra pkill patterns.
wait_for_app() {
  if [[ -n "$WAIT_PID" ]]; then
    log "Waiting for NightFlow (pid ${WAIT_PID}) to quit…"
    for _ in $(seq 1 100); do          # up to ~10s graceful
      kill -0 "$WAIT_PID" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$WAIT_PID" 2>/dev/null; then
      log "Still running; sending TERM."
      kill -TERM "$WAIT_PID" 2>/dev/null || true
      sleep 1
    fi
  fi
  pkill -x "NightFlow" 2>/dev/null || true
  local pat
  for pat in "$@"; do pkill -f "$pat" 2>/dev/null || true; done
  sleep 0.5
}

# =============================================================================
# macOS
# =============================================================================
install_macos() {
  local INSTALL_DIR="/Applications" ARCH_SLUG ASSET DOWNLOAD_URL WORK MOUNT DMG INSTALLED_VER
  case "$(uname -m)" in
    arm64)  ARCH_SLUG="aarch64" ;;
    x86_64) die "Intel Macs are no longer supported; NightFlow ships for Apple silicon only." 1 ;;
    *) die "Unsupported macOS architecture: $(uname -m)" 1 ;;
  esac
  ASSET="NightFlow_${VERSION}_${ARCH_SLUG}.dmg"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
  log "Architecture   : ${ARCH_SLUG} (dmg)"

  if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
    INSTALLED_VER="$(/usr/bin/defaults read \
        "${INSTALL_DIR}/${APP_NAME}/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
    [[ -n "$INSTALLED_VER" ]] && log "Installed      : ${INSTALLED_VER}"
  fi
  confirm

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nightflow-update.XXXXXX")"
  MOUNT="${WORK}/mnt"
  cleanup() {
    if [[ -d "$MOUNT" ]] && mount | grep -q " ${MOUNT} "; then
      hdiutil detach "$MOUNT" -quiet 2>/dev/null \
        || hdiutil detach "$MOUNT" -force -quiet 2>/dev/null || true
    fi
    [[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK" 2>/dev/null || true
  }
  trap cleanup EXIT

  DMG="${WORK}/${ASSET}"
  log "Downloading ${DOWNLOAD_URL}"
  gh_get -o "$DMG" "$DOWNLOAD_URL" \
    || die "Download failed. Does release ${TAG} contain ${ASSET}?" 2
  verify_checksum "$DMG" "$DOWNLOAD_URL"

  wait_for_app

  log "Mounting disk image…"
  mkdir -p "$MOUNT"
  hdiutil attach "$DMG" -nobrowse -noautoopen -mountpoint "$MOUNT" -quiet \
    || die "Could not mount the disk image." 3
  [[ -d "${MOUNT}/${APP_NAME}" ]] \
    || die "Could not find ${APP_NAME} inside the disk image." 3

  if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
    log "Removing previous install…"
    rm -rf "${INSTALL_DIR}/${APP_NAME}" \
      || die "Could not remove old app (try: sudo ${0} …)." 3
  fi

  log "Copying ${APP_NAME} to ${INSTALL_DIR}…"
  cp -R "${MOUNT}/${APP_NAME}" "${INSTALL_DIR}/" || die "Copy failed." 3

  # Gatekeeper: clear quarantine on NightFlow's own bundle, then re-seal the
  # ad-hoc signature we perturbed by editing extended attributes.
  log "Clearing quarantine flag on ${APP_NAME}…"
  xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true
  codesign --force --deep --sign - "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

  log "Installed NightFlow ${VERSION} ✔"
  if [[ "$RELAUNCH" -eq 1 ]]; then
    log "Relaunching NightFlow…"
    open "${INSTALL_DIR}/${APP_NAME}"
  fi
}

# =============================================================================
# Linux
# =============================================================================

# Discover a release asset's download URL by extension, from the release JSON.
# $1 = case-insensitive regex the browser_download_url must match.
pick_asset_url() {
  gh_get "${API}/releases/tags/${TAG}" \
    | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed -E 's/.*"(https:[^"]+)".*/\1/' \
    | grep -iE "$1" \
    | head -1
}

install_linux() {
  local MARCH DEB_ARCH URL WORK FILE
  case "$(uname -m)" in
    x86_64|amd64)   MARCH="(amd64|x86_64|x64)"; DEB_ARCH="amd64" ;;
    aarch64|arm64)  MARCH="(aarch64|arm64)";    DEB_ARCH="arm64" ;;
    *) die "Unsupported Linux architecture: $(uname -m)" 1 ;;
  esac

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nightflow-update.XXXXXX")"
  trap '[[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK" 2>/dev/null || true' EXIT

  if [[ "$USE_DEB" -eq 1 ]]; then
    # ---- .deb system package (needs root) ----
    log "Architecture   : ${DEB_ARCH} (deb)"
    URL="$(pick_asset_url "\.deb$" | grep -iE "$MARCH" || true)"
    [[ -n "$URL" ]] || URL="$(pick_asset_url "\.deb$")"   # fall back to any .deb
    [[ -n "$URL" ]] || die "Release ${TAG} has no .deb asset." 2
    confirm
    FILE="${WORK}/$(basename "$URL")"
    log "Downloading ${URL}"
    gh_get -o "$FILE" "$URL" || die "Download failed." 2
    verify_checksum "$FILE" "$URL"
    wait_for_app "NightFlow" "nightflow"

    local SUDO=""
    [[ "$(id -u)" -ne 0 ]] && SUDO="sudo"
    log "Installing package (may prompt for sudo)…"
    if command -v apt-get >/dev/null; then
      $SUDO apt-get install -y "$FILE" \
        || { $SUDO dpkg -i "$FILE" || true; $SUDO apt-get -f install -y; }
    else
      $SUDO dpkg -i "$FILE" || die "dpkg install failed (missing deps?)." 3
    fi
    log "Installed NightFlow ${VERSION} ✔"
    if [[ "$RELAUNCH" -eq 1 ]] && command -v nightflow >/dev/null; then
      log "Relaunching NightFlow…"; setsid nightflow >/dev/null 2>&1 < /dev/null &
    fi
    return
  fi

  # ---- AppImage (portable, no root) ----
  log "Architecture   : $(uname -m) (AppImage)"
  URL="$(pick_asset_url "\.AppImage$" | grep -iE "$MARCH" || true)"
  [[ -n "$URL" ]] || URL="$(pick_asset_url "\.AppImage$")"   # fall back to any AppImage
  [[ -n "$URL" ]] || die "Release ${TAG} has no .AppImage asset." 2
  confirm
  FILE="${WORK}/$(basename "$URL")"
  log "Downloading ${URL}"
  gh_get -o "$FILE" "$URL" || die "Download failed." 2
  verify_checksum "$FILE" "$URL"

  local BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
  local APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  local DEST="${BIN_DIR}/NightFlow.AppImage"
  mkdir -p "$BIN_DIR" "$APP_DIR"

  wait_for_app "NightFlow.AppImage" "nightflow"

  log "Installing AppImage to ${DEST}…"
  cp -f "$FILE" "$DEST"
  # The only "unblock" an AppImage needs is the executable bit.
  chmod +x "$DEST"

  cat > "${APP_DIR}/nightflow.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=NightFlow
Comment=Manage and analyze deep learning experiments
Exec=${DEST} %U
Terminal=false
Categories=Development;Science;
StartupWMClass=NightFlow
EOF
  command -v update-desktop-database >/dev/null \
    && update-desktop-database "$APP_DIR" 2>/dev/null || true

  log "Installed NightFlow ${VERSION} ✔  (${DEST})"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) log "Note: ${BIN_DIR} is not on your PATH; launch via the app menu or full path." ;;
  esac
  if [[ "$RELAUNCH" -eq 1 ]]; then
    log "Relaunching NightFlow…"
    setsid "$DEST" >/dev/null 2>&1 < /dev/null &
  fi
}

# ---- Dispatch ---------------------------------------------------------------
case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *) die "Unsupported OS: ${OS}. This installer supports macOS and Linux." 1 ;;
esac

exit 0
