#!/usr/bin/env bash
# 一键安装 dsh-fish-jiyu（鲫鱼）。
#
# 真正的活都在 scripts/setup.mjs 里：它按「做 → 验 → 失败回滚」的顺序走，
# 任何一步不对都会把 package.json / cordis.patch.yml 还原，不留半装状态。
#
# 用法：
#   ./install.sh                      # 自动找 profile（只有一个就直接用）
#   ./install.sh --profile web
#   ./install.sh --dry-run            # 只看要改什么，不写盘
#   ./install.sh --verify-only        # 只检查现有安装
#   PROFILE=web ./install.sh          # 老写法也认
#
# 为什么不再用符号链接：宿主只解析 profile 里真实存在的包目录，
# 符号链接能加载但引擎会静默不激活（2026-11-19 实测）。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 node（18 以上）：apt-get install -y nodejs 或装个 node 再跑" >&2
  exit 1
fi

# 老写法：PROFILE=xxx ./install.sh → 转成 --profile xxx
args=("$@")
if [ -n "${PROFILE:-}" ] && [[ " ${args[*]:-} " != *" --profile "* ]]; then
  args+=(--profile "$PROFILE")
fi

exec node "$HERE/scripts/setup.mjs" "${args[@]}"
