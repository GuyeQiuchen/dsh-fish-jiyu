#!/usr/bin/env bash
# Install dsh-fish-jiyu into a DSH profile on macOS / Linux.
#
# Why a copy instead of a symlink: the host only resolves @deepseek-ai/* for
# packages that physically live in the profile. A symlink loads but the engine
# silently never activates (verified 2026-11-19).
#
# Usage:
#   ./install.sh              # desktop profile
#   PROFILE=other ./install.sh
#
# Requires: bash, rsync or cp, node (only for the final syntax check).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${PROFILE:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG="$PROFILE_DIR/package.json"
PATCH="$PROFILE_DIR/cordis.patch.yml"
MOD_DIR="$PROFILE_DIR/node_modules"
TARGET="$MOD_DIR/dsh-fish-jiyu"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG" ]; then
  echo "profile not found: $PKG" >&2
  exit 1
fi

# 1) back up the two files we edit
cp "$PKG" "$PKG.bak-$STAMP"
cp "$PATCH" "$PATCH.bak-$STAMP"
echo "backup: package.json.bak-$STAMP, cordis.patch.yml.bak-$STAMP"

# 2) copy the package into node_modules as a real directory
mkdir -p "$MOD_DIR"
if [ -L "$TARGET" ]; then
  rm "$TARGET"
  echo "broke an existing symlink"
fi
mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '*.bak-*' --exclude 'loaded.txt' --exclude 'load-error.txt' \
    --exclude 'index.full.js*' --exclude 'node_modules' --exclude '.git' \
    "$HERE"/ "$TARGET"/
else
  cp -R "$HERE"/. "$TARGET"/
  rm -rf "$TARGET/node_modules" "$TARGET/.git" "$TARGET/loaded.txt" "$TARGET/load-error.txt"
  find "$TARGET" -maxdepth 1 -name '*.bak-*' -delete 2>/dev/null || true
fi
echo "copied: $HERE -> $TARGET"

# 3) package.json: dependency + bundle entry (node keeps the JSON honest)
node - "$PKG" "$HERE" <<'NODE'
const fs = require('node:fs')
const [pkgPath, here] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.dependencies = pkg.dependencies || {}
const dep = 'link:' + here.replace(/\\/g, '/')
if (!pkg.dependencies['dsh-fish-jiyu']) {
  pkg.dependencies['dsh-fish-jiyu'] = dep
  console.log('dep: dsh-fish-jiyu added')
}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes('dsh-fish-jiyu')) {
  const at = bundles.indexOf('dsh-compaction-vcc')
  if (at < 0) bundles.push('dsh-fish-jiyu')
  else bundles.splice(at + 1, 0, 'dsh-fish-jiyu')
  pkg.dsh.profile.bundles = bundles
  console.log('bundle: dsh-fish-jiyu added after dsh-compaction-vcc')
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
NODE

# 4) cordis.patch.yml: turn vcc off, add the jiyu entry
node - "$PATCH" <<'NODE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
let patch = fs.readFileSync(patchPath, 'utf8')
if (patch.length < 100) {
  console.error('cordis.patch.yml looks empty; aborting')
  process.exit(1)
}
patch = patch.replace(/^- id: compaction-vcc\r?\n  disabled: false/m, '- id: compaction-vcc\n  disabled: true')
if (!/^- id: compaction-jiyu/m.test(patch)) {
  patch = patch.trimEnd() + '\n\n- id: compaction-jiyu\n  config:\n    thresholdRatio: 0.55\n    retainTurns: 1\n    retainTokens: 16384\n'
}
fs.writeFileSync(patchPath, patch, 'utf8')
console.log('patch: compaction-vcc disabled, compaction-jiyu configured')
NODE

# 5) syntax check before telling anyone to restart
if command -v node >/dev/null 2>&1; then
  node --check "$TARGET/index.js"
fi

echo ""
echo "done. Restart DSH to apply."
echo "If you install other plugins later, re-run this script so the package stays a real directory."
