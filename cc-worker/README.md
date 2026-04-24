# cc-worker — Netclass Sidekick Drain Worker

This directory contains the Claude Code slash command that processes the netclass-sidekick question queue using your **local CC subscription** (zero API fees).

## Install

```bash
./install.sh
```

This:
1. Links `drain-netclass.md` into `~/.claude/commands/` (fallback to copy on Windows)
2. Creates `~/.netclass-drain.env` skeleton you must fill in with server URL + admin key

## Usage

In any Claude Code session (VSCode or terminal):

```
/drain-netclass 10
```

Processes 10 pending questions. Optional filters: `--platform chaoxing` / `--type single`.

## Files

- `drain-netclass.md` — The slash command. Edit this, run `./install.sh` to re-link.
- `install.sh` — Installer script.

## See also

- `../docs/DRAIN-WORKFLOW.md` — Full workflow explanation, delay model, troubleshooting
- `../docs/PROTOCOL.md` — `/admin/pending` and `/admin/submit` API contract
