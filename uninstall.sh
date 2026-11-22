#!/usr/bin/env bash
# Uninstall dsh-fish-jiyu from a DSH profile.
#
# Reverses install.sh: removes the copied package, the dependency, the bundle
# entry and the compaction-jiyu patch block. Restores compaction-vcc if it is
# still listed in the profile.
#
# Usage:
#   ./uninstall.sh              # desktop profile
#   PROFILE=other ./uninstall.sh

set -euo pipefail

PROFILE="${PROFILE:-desktop}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG="$PROFILE_DIR/package.json"
PATCH="$PROFILE_DIR/cordis.patch.yml"
TARGET="$PROFILE_DIR/node_modules/dsh-fish-jiyu"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f "$PKG" ]; then
  echo "profile not found: $PKG" >&2
  exit 1
fi

cp "$PKG" "$PKG.bak-$STAMP"
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-$STAMP"
  echo "backup: package.json.bak-$STAMP, cordis.patch.yml.bak-$STAMP"
else
  echo "backup: package.json.bak-$STAMP (no cordis.patch.yml)"
fi

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  rm -rf "$TARGET"
  echo "removed: $TARGET"
fi

node - "$PKG" <<'NODE'
const fs = require('node:fs')
const [pkgPath] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
if (pkg.dependencies) delete pkg.dependencies['dsh-fish-jiyu']
const bundles = pkg.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  pkg.dsh.profile.bundles = bundles.filter((b) => b !== 'dsh-fish-jiyu')
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('package.json cleaned')
NODE

if [ -f "$PATCH" ]; then
node - "$PATCH" <<'NODE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
let patch = fs.readFileSync(patchPath, 'utf8')
patch = patch.replace(/\n*- id: compaction-jiyu\r?\n(?:  .*\r?\n)*/m, '\n')
patch = patch.replace(/^- id: compaction-vcc\r?\n  disabled: true/m, '- id: compaction-vcc\n  disabled: false')
fs.writeFileSync(patchPath, patch, 'utf8')
console.log('patch: compaction-jiyu removed, compaction-vcc re-enabled')
NODE
else
  echo "patch: no cordis.patch.yml; skipped"
fi

echo ""
echo "done. Restart DSH to apply."
