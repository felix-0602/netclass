#!/usr/bin/env bash
# Netclass Sidekick — 首次在新 VPS 上部署
# 用法：
#   1. SSH 登录 VPS (ubuntu@<IP>)
#   2. curl -o init.sh https://raw.githubusercontent.com/<你>/netclass/main/deploy/scripts/init.sh
#      或先 git clone，然后 bash deploy/scripts/init.sh
#
# 假设：Ubuntu 22.04/24.04 LTS，用户是 ubuntu（sudo 权限）

set -euo pipefail

echo "======================================"
echo "Netclass Sidekick — 首次部署初始化"
echo "======================================"

# -------- 1. 装 Node 20 --------
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  echo "[1/6] 安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt-get install -y nodejs
else
  echo "[1/6] Node.js 已装：$(node --version)"
fi

# -------- 2. 装 git & build tools（better-sqlite3 需要） --------
echo "[2/6] 安装 git + build-essential..."
sudo apt-get install -y git build-essential python3

# -------- 3. 拉代码（如果还没拉） --------
REPO_DIR="${HOME}/netclass"
if [ ! -d "$REPO_DIR" ]; then
  echo "[3/6] Clone repo 到 $REPO_DIR..."
  read -rp "请输入 git repo URL（如 git@github.com:you/netclass.git）: " GIT_URL
  git clone "$GIT_URL" "$REPO_DIR"
else
  echo "[3/6] Repo 已存在，跳过 clone"
fi

cd "$REPO_DIR/server"

# -------- 4. 装依赖 + 应用迁移 --------
echo "[4/6] npm install + db:migrate..."
npm install --production=false --no-audit --no-fund
npx tsx src/db/apply-migrations.ts

# -------- 5. .env 配置 --------
if [ ! -f .env ]; then
  echo "[5/6] 生成 .env..."
  cp ../deploy/.env.example .env
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ADMIN_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env
  sed -i "s|^ADMIN_KEY=.*|ADMIN_KEY=$ADMIN_KEY|" .env
  chmod 600 .env
  echo ""
  echo "✓ 已生成随机 JWT_SECRET / ADMIN_KEY"
  echo ""
  echo "⚠ 记下下面这个 ADMIN_KEY，配置 cc-worker 的 ~/.netclass-drain.env 要用："
  echo ""
  echo "  ADMIN_KEY=$ADMIN_KEY"
  echo ""
else
  echo "[5/6] .env 已存在，跳过"
fi

# -------- 6. systemd 注册 --------
echo "[6/6] 注册 systemd service..."
sudo cp "$REPO_DIR/deploy/systemd/netclass.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable netclass
sudo systemctl restart netclass

sleep 2
if systemctl is-active --quiet netclass; then
  echo ""
  echo "✅ Netclass Sidekick 已启动"
  echo ""
  echo "本机健康检查："
  curl -sS http://127.0.0.1:8080/healthz && echo ""
  echo ""
  echo "下一步："
  echo "  1. 开放端口 8080（腾讯云控制台 → 防火墙 → 放行 TCP 8080）"
  echo "  2. 外部访问：http://<你的公网 IP>:8080/healthz"
  echo "  3. 更新代码：bash deploy/scripts/update.sh"
  echo ""
  echo "日志：sudo journalctl -u netclass -f"
else
  echo "❌ netclass 服务未启动，查看日志："
  sudo journalctl -u netclass -n 50 --no-pager
  exit 1
fi
