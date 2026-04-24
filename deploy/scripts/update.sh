#!/usr/bin/env bash
# Netclass Sidekick — 更新部署（非首次）
# 用法：在 VPS 上 SSH 进去，cd 到 repo，bash deploy/scripts/update.sh
#
# 做三件事：git pull / npm install / apply migrations / 重启 systemd

set -euo pipefail

cd "$(git rev-parse --show-toplevel)/server"

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
