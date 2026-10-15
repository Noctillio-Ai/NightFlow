#!/usr/bin/env bash
#
# install.sh — install NightFlow on macOS or Linux from its GitHub release.
#
# Run directly:
#   curl -fsSL https://raw.githubusercontent.com/Noctillio-Ai/NightFlow/main/install.sh | bash
#
# or with options:
#   ./install.sh --version 0.3.0 --relaunch
#   ./install.sh --deb            # Linux: install the .deb system package instead of the AppImage
#
# macOS: installs the .dmg to /Applications and clears the Gatekeeper quarantine
# flag on the NightFlow bundle it just installed. NightFlow is ad-hoc signed (not
# Apple-notarized), so that flag would otherwise block launch; removing it from
# this one bundle is the normal step for a self-distributed app, and nothing else
# is touched.
#
# Linux: installs the portable AppImage into ~/.local/bin (no root) with a desktop
# entry, or the .deb system package with --deb. There is no Gatekeeper on Linux;
# the only "unblock" needed for an AppImage is making it executable (chmod +x).
#
# Options:
#   --version X.Y.Z   Install this version. Default: latest GitHub release.
#   --relaunch        Open NightFlow after installing.
#   --deb             Linux only: install the .deb package (needs sudo) instead of the AppImage.
#   --yes, -y         Don't prompt (assumed when piped from curl).
#
# Env:
#   NIGHTFLOW_REPO    owner/repo hosting releases (default: Noctillio-Ai/NightFlow)
#   GITHUB_TOKEN      optional, raises API rate limit / allows private repo

set -euo pipefail

REPO="${NIGHTFLOW_REPO:-Noctillio-Ai/NightFlow}"
APP_NAME="NightFlow.app"
API="https://api.github.com/repos/${REPO}"

VERSION=""
RELAUNCH=0
ASSUME_YES=0
USE_DEB=0
# When stdin isn't a terminal (curl | bash), there's no one to prompt.
[[ -t 0 ]] || ASSUME_YES=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  VERSION="${2:?--version needs a value}"; shift 2 ;;
    --relaunch) RELAUNCH=1; shift ;;
    --deb)      USE_DEB=1; shift ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;36m[nightflow]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[nightflow]\033[0m %s\n' "$*" >&2; exit "${2:-1}"; }

OS="$(uname -s)"
command -v curl >/dev/null || die "curl is required."

gh_get() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" "$@"
  else
    curl -fsSL "$@"
  fi
}

# ---- Resolve version / tag --------------------------------------------------
if [[ -z "$VERSION" ]]; then
  log "Resolving latest release of ${REPO}…"
  TAG="$(gh_get "${API}/releases/latest" \
        | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')" \
        || die "Could not reach the GitHub API."
  [[ -n "$TAG" ]] || die "No releases found for ${REPO}."
  VERSION="${TAG#v}"
else
  TAG="v${VERSION#v}"
  VERSION="${VERSION#v}"
fi

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
      || die "Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}"
    log "Checksum OK (${actual})"
  else
    log "No published checksum; skipping verification."
  fi
}

confirm() {
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    printf 'Install NightFlow %s? [y/N] ' "$VERSION"
    read -r reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "Cancelled."
  fi
}

log "Version      : ${VERSION} (${TAG})"

# =============================================================================
# macOS
# =============================================================================
install_macos() {
  local INSTALL_DIR="/Applications" ARCH_SLUG ASSET DOWNLOAD_URL WORK MOUNT DMG
  case "$(uname -m)" in
    arm64)  ARCH_SLUG="aarch64" ;;
    x86_64) die "Intel Macs are no longer supported; NightFlow ships for Apple silicon only." ;;
    *) die "Unsupported macOS architecture: $(uname -m)" ;;
  esac
  ASSET="NightFlow_${VERSION}_${ARCH_SLUG}.dmg"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"
  log "Architecture : ${ARCH_SLUG} (dmg)"
  confirm

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nightflow-install.XXXXXX")"
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
    || die "Download failed. Does release ${TAG} contain ${ASSET}?"
  verify_checksum "$DMG" "$DOWNLOAD_URL"

  pkill -x "NightFlow" 2>/dev/null || true
  sleep 0.5

  log "Mounting disk image…"
  mkdir -p "$MOUNT"
  hdiutil attach "$DMG" -nobrowse -noautoopen -mountpoint "$MOUNT" -quiet \
    || die "Could not mount the disk image."
  [[ -d "${MOUNT}/${APP_NAME}" ]] \
    || die "Could not find ${APP_NAME} inside the disk image."

  if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
    log "Removing previous install…"
    rm -rf "${INSTALL_DIR}/${APP_NAME}" \
      || die "Could not remove old app (try: sudo bash install.sh)."
  fi

  log "Installing ${APP_NAME} to ${INSTALL_DIR}…"
  cp -R "${MOUNT}/${APP_NAME}" "${INSTALL_DIR}/" || die "Copy failed."

  # Gatekeeper: clear quarantine on NightFlow's own bundle, then re-seal the
  # ad-hoc signature we perturbed by editing extended attributes.
  log "Clearing quarantine flag on ${APP_NAME}…"
  xattr -dr com.apple.quarantine "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true
  codesign --force --deep --sign - "${INSTALL_DIR}/${APP_NAME}" 2>/dev/null || true

  log "Installed NightFlow ${VERSION} ✔"
  if [[ "$RELAUNCH" -eq 1 ]]; then
    log "Launching NightFlow…"
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
    *) die "Unsupported Linux architecture: $(uname -m)" ;;
  esac

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/nightflow-install.XXXXXX")"
  trap '[[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK" 2>/dev/null || true' EXIT

  if [[ "$USE_DEB" -eq 1 ]]; then
    # ---- .deb system package (needs root) ----
    log "Architecture : ${DEB_ARCH} (deb)"
    URL="$(pick_asset_url "\.deb$" | grep -iE "$MARCH" || true)"
    [[ -n "$URL" ]] || URL="$(pick_asset_url "\.deb$")"   # fall back to any .deb
    [[ -n "$URL" ]] || die "Release ${TAG} has no .deb asset."
    confirm
    FILE="${WORK}/$(basename "$URL")"
    log "Downloading ${URL}"
    gh_get -o "$FILE" "$URL" || die "Download failed."
    verify_checksum "$FILE" "$URL"

    local SUDO=""
    [[ "$(id -u)" -ne 0 ]] && SUDO="sudo"
    log "Installing package (may prompt for sudo)…"
    if command -v apt-get >/dev/null; then
      $SUDO apt-get install -y "$FILE" \
        || { $SUDO dpkg -i "$FILE" || true; $SUDO apt-get -f install -y; }
    else
      $SUDO dpkg -i "$FILE" || die "dpkg install failed (missing deps?)."
    fi
    log "Installed NightFlow ${VERSION} ✔"
    if [[ "$RELAUNCH" -eq 1 ]] && command -v nightflow >/dev/null; then
      log "Launching NightFlow…"; setsid nightflow >/dev/null 2>&1 < /dev/null &
    fi
    return
  fi

  # ---- AppImage (portable, no root) ----
  log "Architecture : $(uname -m) (AppImage)"
  URL="$(pick_asset_url "\.AppImage$" | grep -iE "$MARCH" || true)"
  [[ -n "$URL" ]] || URL="$(pick_asset_url "\.AppImage$")"   # fall back to any AppImage
  [[ -n "$URL" ]] || die "Release ${TAG} has no .AppImage asset."
  confirm
  FILE="${WORK}/$(basename "$URL")"
  log "Downloading ${URL}"
  gh_get -o "$FILE" "$URL" || die "Download failed."
  verify_checksum "$FILE" "$URL"

  local BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
  local APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  local DEST="${BIN_DIR}/NightFlow.AppImage"
  mkdir -p "$BIN_DIR" "$APP_DIR"

  pkill -f "NightFlow.AppImage" 2>/dev/null || true
  sleep 0.3

  log "Installing AppImage to ${DEST}…"
  cp -f "$FILE" "$DEST"
  # The only "unblock" an AppImage needs is the executable bit.
  chmod +x "$DEST"

  # Desktop entry so it shows up in the app menu.
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
    *) log "Note: ${BIN_DIR} is not on your PATH; add it to launch 'NightFlow.AppImage' from a shell." ;;
  esac
  if [[ "$RELAUNCH" -eq 1 ]]; then
    log "Launching NightFlow…"
    setsid "$DEST" >/dev/null 2>&1 < /dev/null &
  fi
}

# ---- Dispatch ---------------------------------------------------------------
case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *) die "Unsupported OS: ${OS}. This installer supports macOS and Linux." ;;
esac
