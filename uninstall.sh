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
HERE="$(cd "$(dirname "$0")" && pwd)"

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

# 撤销剪裁配置：我们以前把 tool-result-pruner 设成 2000/1200/500，
# 卸载后不该把它留在 profile 里。
if [ -f "$PATCH" ] && command -v node >/dev/null 2>&1; then
  node "$HERE/scripts/clear-tool-pruner.mjs" "$PROFILE_DIR" || echo "pruner: 撤销失败（不影响卸载）"
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
node - "$PATCH" <<'NODE_PATCH'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
let patch = fs.readFileSync(patchPath, 'utf8')
patch = patch.replace(/\n*- id: compaction-jiyu\r?\n(?:  .*\r?\n)*/m, '\n')
patch = patch.replace(/^- id: compaction-vcc\r?\n  disabled: true/m, '- id: compaction-vcc\n  disabled: false')
fs.writeFileSync(patchPath, patch, 'utf8')
console.log('patch: compaction-jiyu removed, compaction-vcc re-enabled')
NODE_PATCH
else
  echo "patch: no cordis.patch.yml; skipped"
fi

# 卸载时把本地副本也清掉，否则下次重装会用旧的
if [ -d "$PROFILE_DIR/local-packages/dsh-fish-jiyu" ]; then
  rm -rf "$PROFILE_DIR/local-packages/dsh-fish-jiyu"
  echo "removed: local-packages/dsh-fish-jiyu"
fi

# 兜底：如果 patch 里已经没有任何启用的压缩引擎，就重新启用宿主自带的 basic。
# 否则卸载完会变成「没有压缩」，上下文一到线就报错。
if [ -f "$PATCH" ]; then
node - "$PATCH" <<'NODE_ENGINE'
const fs = require('node:fs')
const [patchPath] = process.argv.slice(2)
const lines = fs.readFileSync(patchPath, 'utf8').split('\n')
const rows = []
for (let i = 0; i < lines.length; i += 1) {
  const m = /^- id:\s*(\S+)\s*$/.exec(lines[i])
  if (m === null) continue
  let end = i + 1
  while (end < lines.length && !/^-\s/.test(lines[end])) end += 1
  rows.push({ id: m[1], start: i, end })
}
const engines = rows.filter((row) => row.id.startsWith('compaction-'))
const enabled = engines.filter((row) => {
  const body = lines.slice(row.start, row.end)
  const disabled = body.find((line) => /^ {2}disabled:\s*true\s*$/.test(line))
  return disabled === undefined
})
if (enabled.length > 0) {
  console.log(`patch: 还有 ${enabled.map((row) => row.id).join('/')} 在跑，不动`)
  process.exit(0)
}
const basic = rows.find((row) => row.id === 'compaction-basic')
if (basic === undefined) {
  console.log('patch: 没有 compaction-basic 可恢复，跳过')
  process.exit(0)
}
const body = lines.slice(basic.start, basic.end)
const at = body.findIndex((line) => /^ {2}disabled:\s*true\s*$/.test(line))
if (at >= 0) body.splice(at, 1)
lines.splice(basic.start, basic.end - basic.start, ...body)
fs.writeFileSync(patchPath, lines.join('\n'))
console.log('patch: 没有别的压缩引擎了，重新启用 compaction-basic')
NODE_ENGINE
fi

echo ""
echo "done. Restart DSH to apply."
