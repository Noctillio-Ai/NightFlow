#!/usr/bin/env bash
#
# update-netron.sh — replace the bundled Netron model viewer (public/netron)
# with a release from PyPI. Netron's Python wheel ships the whole web viewer,
# so this downloads the wheel, checks its SHA-256 against PyPI, and copies the
# viewer files in. The installed version is written to public/netron/VERSION.
#
# Nothing updates automatically: run this, check the Model Viewer still loads
# a model, then commit the result.
#
# Usage:
#   scripts/update-netron.sh            # latest release
#   scripts/update-netron.sh 8.4.2      # a specific version
#   scripts/update-netron.sh --check    # only report bundled vs latest
#
# Needs: curl, unzip, python3 (for parsing PyPI's JSON).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/public/netron"
PYPI="https://pypi.org/pypi/netron"

die() { echo "error: $*" >&2; exit 1; }
for tool in curl unzip python3; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done

bundled="$(cat "$DEST/VERSION" 2>/dev/null || echo "unknown")"

# Field from a PyPI JSON document on stdin: version, or the wheel's url / sha256.
pypi_field() {
  python3 -c '
import json, sys
doc = json.load(sys.stdin)
field = sys.argv[1]
if field == "version":
    print(doc["info"]["version"])
else:
    wheels = [u for u in doc["urls"] if u["packagetype"] == "bdist_wheel"]
    if not wheels:
        sys.exit("no wheel published for this version")
    print(wheels[0]["url"] if field == "url" else wheels[0]["digests"]["sha256"])
' "$1"
}

latest="$(curl -fsSL "$PYPI/json" | pypi_field version)" || die "could not reach PyPI"

if [[ "${1:-}" == "--check" ]]; then
  echo "bundled: $bundled"
  echo "latest:  $latest"
  [[ "$bundled" == "$latest" ]] && echo "Up to date." || echo "Run scripts/update-netron.sh to update."
  exit 0
fi

version="${1:-$latest}"
[[ "$version" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || die "not a version: $version"
if [[ "$version" == "$bundled" ]]; then
  echo "Netron $version is already bundled."
  exit 0
fi

meta="$(curl -fsSL "$PYPI/$version/json")" || die "Netron $version not found on PyPI"
url="$(pypi_field url <<<"$meta")"
sha="$(pypi_field sha256 <<<"$meta")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Netron ${version}…"
curl -fsSL "$url" -o "$tmp/netron.whl"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/netron.whl" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/netron.whl" | cut -d' ' -f1)"
fi
[[ "$actual" == "$sha" ]] || die "checksum mismatch (expected $sha, got $actual)"

unzip -q "$tmp/netron.whl" 'netron/*' -d "$tmp/wheel"
src="$tmp/wheel/netron"
[[ -f "$src/index.html" && -f "$src/index.js" ]] || die "the wheel doesn't contain the web viewer (no netron/index.html)"

# Swap in the new files; anything the new release no longer ships is removed.
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$src/." "$DEST/"
find "$DEST" -name '__pycache__' -type d -prune -exec rm -rf {} +
echo "$version" > "$DEST/VERSION"

echo "Updated public/netron: ${bundled} → ${version}"
echo "Next: open Model Viewer in the app, load a model, then commit public/netron."
