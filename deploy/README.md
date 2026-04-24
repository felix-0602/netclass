# Netclass Sidekick — 部署手册

> 面向：第一次 SSH Linux 服务器的 CS 大一学生。
> 目标：腾讯云轻量学生版 + Ubuntu 24.04 + 裸 IP HTTP → 全过程 15-30 分钟。

## 0. 前置

- 腾讯云账号（学信网实名认证过）
- 买一台**轻量应用服务器**
  - 机房：选广州 / 上海（国内延迟最低）
  - 系统镜像：**Ubuntu Server 24.04 LTS 64-bit**（**不要**选带宝塔面板的）
  - 配置：2 核 2G / 3G 带宽 / 40G SSD（学生价 ¥15/年起）
  - 应用模板：**原生镜像** — 不要套 WordPress / 宝塔 / LAMP 这些
- 拿到服务器后**记住**：
  - 公网 IP（腾讯云控制台显示）
  - 初始 root 密码（或你自己设的 ubuntu 密码）
- 一个 Git 仓库（把 `d:/Projects/learning` push 到 GitHub / Gitee 都行，私有仓库最佳）

---

## 1. SSH 登录

Windows 用 PowerShell（或 git bash）：

```bash
ssh ubuntu@<你的公网 IP>
# 首次连接会让确认 fingerprint，输 yes
# 输密码（腾讯云控制台重置过的那个）
```

如果是 root 登录，先建个非 root 用户：

```bash
# 仅在 root 登录时跑
adduser ubuntu
usermod -aG sudo ubuntu
# 之后用 ubuntu 登录
```

---

## 2. 一键初始化（推荐）

登录后直接跑：

```bash
# 拉代码
git clone <你的 repo URL> netclass
cd netclass
# 执行初始化脚本
bash deploy/scripts/init.sh
```

脚本会自动做：

1. 装 Node.js 20 + build 工具
2. `npm install`
3. 应用数据库 migrations
4. 生成随机 JWT_SECRET / ADMIN_KEY 到 `server/.env`
5. 注册 systemd service + 自启
6. 本机 curl /healthz 验证

**注意**：脚本结尾会**打印一行 ADMIN_KEY**，请立刻复制下来——这个值要配进
你本地开发机的 `~/.netclass-drain.env`，让 `/drain-netclass` 能调
生产服务端。**一旦关了 SSH 窗口就找不回，只能去 `cat server/.env` 再看一次**。

---

## 3. 开放防火墙端口

腾讯云轻量默认防火墙只开了 22（SSH）和 80。**你还要开 8080**（Node 监听端口）：

**方式 1：腾讯云控制台**（推荐）
1. 登录 https://console.cloud.tencent.com/lighthouse
2. 点你的服务器 → 防火墙
3. 添加规则：协议 TCP、端口 **8080**、策略 允许
4. 保存

**方式 2：SSH 里跑 ufw**（如果你启用了 ufw）

```bash
sudo ufw allow 8080/tcp
sudo ufw reload
```

---

## 4. 外部验证

在你的本地电脑（**不在 SSH 会话里**）的 PowerShell 跑：

```powershell
Invoke-WebRequest http://<公网 IP>:8080/healthz -UseBasicParsing | Select-Object -ExpandProperty Content
```

应返回：
```json
{"status":"ok","protocol":"1.0.0-alpha","time":"2026-..."}
```

如果卡住或报错：
- 检查防火墙 8080 端口是否放行
- 检查服务是否起来：`ssh` 进去跑 `sudo systemctl status netclass`
- 看日志：`sudo journalctl -u netclass -n 50`

---

## 5. 配置本地 drain

**在你本地开发机**（不是 VPS）：

```bash
# 编辑 ~/.netclass-drain.env
# （Windows git bash 路径是 /c/Users/<你>/.netclass-drain.env）

NETCLASS_SERVER=http://<公网 IP>:8080
NETCLASS_ADMIN_KEY=<init.sh 打印出来的那个 ADMIN_KEY>
```

然后在任意 Claude Code 会话里：

```
/drain-netclass 1
```

如果返回 "队列空，无事可做" —— **恭喜，Phase 0 Week 2 收尾，生产服务端就绪**。

---

## 6. 常用运维命令

```bash
# 查看服务状态
sudo systemctl status netclass

# 查看实时日志（按 Ctrl+C 退出）
sudo journalctl -u netclass -f

# 查看最近 100 行日志
sudo journalctl -u netclass -n 100

# 重启服务
sudo systemctl restart netclass

# 停止服务
sudo systemctl stop netclass

# 启动服务
sudo systemctl start netclass

# 查看端口占用
sudo ss -tlnp | grep 8080
```

---

## 7. 更新代码

每次本地 git push 后，SSH 到 VPS 跑：

```bash
cd ~/netclass
bash deploy/scripts/update.sh
```

做四件事：`git pull` + `npm install` + 应用新迁移 + 重启 systemd。

---

## 8. 常见坑

| 症状 | 原因 | 解决 |
|---|---|---|
| `npm install` 报 `node-gyp` 错 | build tools 没装 | `sudo apt install -y build-essential python3` |
| 服务启动后秒退 | `.env` 里 JWT_SECRET 是空 | 重跑 init.sh 或手工 `node -e "crypto.randomBytes(32).toString('hex')"` 填入 |
| 外部访问超时 | 腾讯云防火墙 8080 没开 | 见第 3 节 |
| 外部访问 502 / connection refused | Node 监听 127.0.0.1 而非 0.0.0.0 | 检查 `src/server.ts` 里 `hostname: '0.0.0.0'` |
| `sudo systemctl enable` 找不到 service | 忘了 `daemon-reload` | `sudo systemctl daemon-reload` |
| 日志里 `Cannot find module 'tsx'` | systemd 服务跑时 `$PATH` 不含 npm bin | unit 里已用绝对路径 `node_modules/tsx/dist/cli.mjs`，检查路径是否对 |

---

## 9. 下阶段（不在本次范围）

- **HTTPS**：等 Phase 2 申请免费 Let's Encrypt 证书 + nginx（需要域名）
- **反向代理**：加 nginx 后可 443 入口 + 多服务共存
- **自动部署**：GitHub Actions SSH 到 VPS 触发 update.sh
- **监控**：Grafana / Uptime Kuma 看健康
- **备份**：定时把 `server/netclass.db` copy 到 COS 对象存储
