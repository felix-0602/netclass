#!/usr/bin/env bash
# Netclass Sidekick — 更新部署（非首次）
# 用法：在 VPS 上 SSH 进去，cd 到 repo，bash deploy/scripts/update.sh
#
# 做三件事：git pull / npm install / apply migrations / 重启 systemd

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# 实测过坑：服务器偶发有调试 / 过期改动挡 git pull --rebase。
# 自动 stash 一下 — 名字带时间戳，事后能 git stash list 看回。
if ! git diff --quiet || ! git diff --cached --quiet; then
  STASH_NAME="auto-update-$(date +%Y%m%d-%H%M%S)"
  echo "[0/4] 检测到本地未提交改动，先 stash → $STASH_NAME"
  git stash push -u -m "$STASH_NAME"
  echo "      （事后 git stash list 看回，git stash drop 丢弃）"
fi

cd server

echo "[1/4] git pull..."
git pull --rebase

echo "[2/4] npm install..."
npm install --production=false --no-audit --no-fund

echo "[3/4] 应用新迁移（如有）..."
npx tsx src/db/apply-migrations.ts

echo "[4/4] 重启 systemd service..."
sudo systemctl restart netclass

sleep 2
if systemctl is-active --quiet netclass; then
  echo "✅ 已重启"
  curl -sS http://127.0.0.1:8080/healthz && echo ""
else
  echo "❌ 服务启动失败，日志："
  sudo journalctl -u netclass -n 30 --no-pager
  exit 1
fi
