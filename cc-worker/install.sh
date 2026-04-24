#!/usr/bin/env bash
# 把 drain-netclass 斜杠命令安装到 ~/.claude/commands/
# 用法：./cc-worker/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/drain-netclass.md"
DST_DIR="$HOME/.claude/commands"
DST="$DST_DIR/drain-netclass.md"

if [ ! -f "$SRC" ]; then
  echo "错误：找不到 $SRC" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

# 优先建软链接，这样编辑仓库里的 md 立刻反映到安装位置
# Windows git bash 可能不支持 ln，降级为 copy
if ln -sf "$SRC" "$DST" 2>/dev/null; then
  echo "✓ 已软链 $DST → $SRC"
else
  cp -f "$SRC" "$DST"
  echo "✓ 已复制 $SRC → $DST"
  echo "  （ln -sf 失败 — 以后改了 drain-netclass.md 要重跑 install.sh）"
fi

# 若 env 文件不存在，建骨架
ENV_FILE="$HOME/.netclass-drain.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# netclass-sidekick drain 凭据
# 服务端部署完毕后把下面两行填上

NETCLASS_SERVER=https://netclass-sidekick.example.workers.dev
NETCLASS_ADMIN_KEY=change-me
EOF
  chmod 600 "$ENV_FILE"
  echo "✓ 已在 $ENV_FILE 生成 env 骨架 — 首次 drain 前务必填上 server + admin key。"
else
  echo "✓ env 文件已存在：$ENV_FILE"
fi

echo ""
echo "下一步：服务端部署完毕后，在 Claude Code 里输 '/drain-netclass 10'。"
