# cc-worker — Netclass Sidekick 队列消化器

本目录存放 Claude Code 斜杠命令。它用你**本地的 CC 订阅**（零 API 费）消化
netclass-sidekick 服务端的题库 pending 队列。

## 安装

```bash
./install.sh
```

做两件事：
1. 把 `drain-netclass.md` 软链到 `~/.claude/commands/`（Windows 下降级为复制）
2. 在 `~/.netclass-drain.env` 建骨架文件，让你填服务端 URL + admin key

## 用法

在任意 Claude Code 会话里（VSCode 或终端）：

```
/drain-netclass 10
```

一次处理 10 道 pending 题。可选过滤：`--platform chaoxing` / `--type single`。

## 文件说明

- `drain-netclass.md` — 斜杠命令本体。改完后再跑 `./install.sh` 重新软链。
- `install.sh` — 安装脚本。

## 参考

- `../docs/DRAIN-WORKFLOW.md` — 完整工作流、延迟模型、故障排查
- `../docs/PROTOCOL.md` — `/admin/pending` 和 `/admin/submit` 的 API 合约
