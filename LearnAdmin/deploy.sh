#!/bin/bash
# LearnAdmin 部署脚本
set -e

VPS="ubuntu@182.254.180.181"
VPS_PATH="/home/ubuntu/learn-admin"
LOCAL="$(cd "$(dirname "$0")" && pwd)"

echo "[deploy] syncing $LOCAL → $VPS:$VPS_PATH"
ssh "$VPS" "mkdir -p $VPS_PATH"
scp -r "$LOCAL/src" "$LOCAL/package.json" "$LOCAL/tsconfig.json" "$VPS:$VPS_PATH/"

echo "[deploy] creating .env (reuses main server's ADMIN_KEY & DB)..."
ssh "$VPS" "cat > $VPS_PATH/.env << 'EOF'
ADMIN_KEY=\$(grep ADMIN_KEY /home/ubuntu/netclass/server/.env | cut -d= -f2)
DB_PATH=/home/ubuntu/netclass/server/netclass.db
PORT=3000
EOF"

echo "[deploy] npm install..."
ssh "$VPS" "cd $VPS_PATH && npm install" 2>&1 | tail -3

echo "[deploy] restarting..."
ssh "$VPS" "
  pkill -f 'learn-admin' 2>/dev/null || true
  cd $VPS_PATH
  nohup npx tsx src/server.ts > /tmp/learn-admin.log 2>&1 &
  sleep 2
  head -2 /tmp/learn-admin.log
"

echo "[deploy] done → http://182.254.180.181:3000/"
