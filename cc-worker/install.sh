#!/usr/bin/env bash
# Install the drain-netclass slash command into ~/.claude/commands/
# Usage: ./cc-worker/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/drain-netclass.md"
DST_DIR="$HOME/.claude/commands"
DST="$DST_DIR/drain-netclass.md"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

# Prefer symlink so edits in repo flow to installed command immediately.
# Windows (git bash) may not support ln; fallback to copy.
if ln -sf "$SRC" "$DST" 2>/dev/null; then
  echo "✓ Linked $DST → $SRC"
else
  cp -f "$SRC" "$DST"
  echo "✓ Copied $SRC → $DST"
  echo "  (ln -sf failed — you'll need to re-run install.sh after editing drain-netclass.md)"
fi

# Create env file skeleton if missing
ENV_FILE="$HOME/.netclass-drain.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# netclass-sidekick drain credentials
# Fill these in after server deployment

NETCLASS_SERVER=https://netclass-sidekick.example.workers.dev
NETCLASS_ADMIN_KEY=change-me
EOF
  chmod 600 "$ENV_FILE"
  echo "✓ Created env skeleton at $ENV_FILE — fill in server + admin key before first drain."
else
  echo "✓ Env file already exists at $ENV_FILE"
fi

echo ""
echo "Next: open Claude Code and run '/drain-netclass 10' once server is deployed."
