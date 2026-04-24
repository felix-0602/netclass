---
description: Drain pending netclass question queue via local Claude Code (no API fees)
argument-hint: "[count=10] [--platform chaoxing|zhihuishu|unipus] [--type single|multi|judge|fill]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# /drain-netclass — Process pending netclass-sidekick question queue

You are acting as the answer-generation worker for the netclass-sidekick service.
Each run pulls N pending questions from the server, answers them using your reasoning
(with vision for image-based math questions), and submits the batch back.

## Arguments

$ARGUMENTS — usually just a count like `10`. Also accepts `--platform X` / `--type Y`.

Default `count=10` if not specified.

## Environment

Credentials live in `~/.netclass-drain.env`:
```bash
NETCLASS_SERVER=https://netclass-sidekick.<account>.workers.dev
NETCLASS_ADMIN_KEY=<X-Admin-Key>
```

If the env file doesn't exist, STOP and tell the user:
> Missing `~/.netclass-drain.env`. Run `./cc-worker/install.sh` from the project root to set it up.

## Workflow

### Step 1 — Pull pending queue

Parse `$ARGUMENTS` into `COUNT` (default 10) and optional filters (`--platform`, `--type`).
Always load env first so both `NETCLASS_SERVER` and `NETCLASS_ADMIN_KEY` are in scope for every subsequent curl.

```bash
set -a && source ~/.netclass-drain.env && set +a
curl -sS -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
     "$NETCLASS_SERVER/admin/pending?limit=${COUNT:-10}" \
     > /tmp/netclass-pending.json

# Sanity check
jq '.items | length' /tmp/netclass-pending.json
```

Read `/tmp/netclass-pending.json`. If `items` is empty, print "Queue empty, nothing to drain." and exit.

### Step 2 — Process each pending item

For each `item` in `items`:

1. **Download image if present** (R2 public URL, no referer needed):
   ```bash
   [ -n "$IMG_URL" ] && curl -sS -o /tmp/nc-q-${ID}.png "$IMG_URL"
   ```

2. **Read the item**:
   - Read `/tmp/netclass-pending.json` to get the item's text, options, tex_spans
   - If `composite_image_url` was downloaded, Read `/tmp/nc-q-${ID}.png` for vision input

3. **Reason about the answer**:
   - Single-choice: identify correct letter
   - Multi-choice: identify all correct letters
   - Judge: true/false
   - Fill-in: provide exact expected text
   - If you cannot determine with confidence ≥ 0.7, mark it uncertain and include reasoning in `note`

4. **Emit a JSON entry**:
   ```json
   {
     "id": "<hash>",
     "answer": {"value": "D", "raw": ["D"]},
     "confidence": 0.95,
     "source": "cc_drain",
     "note": "Given y(0)=1, C=1, so particular solution is y=x²+1 → D"
   }
   ```

Collect all entries into a single array.

### Step 3 — Submit batch

Write the array to `/tmp/netclass-answers.json` using the Write tool, then POST:

```bash
curl -sS -X POST \
     -H "X-Admin-Key: $NETCLASS_ADMIN_KEY" \
     -H "Content-Type: application/json" \
     -d @/tmp/netclass-answers.json \
     "$NETCLASS_SERVER/admin/submit"
```

### Step 4 — Summary report

Display to the user:

```
Drain complete — 10 questions processed in 2m 34s
  ✓ Accepted:  8  (written to D1 questions table)
  ⚠ Uncertain: 1  (confidence < 0.7, kept in pending for re-review)
  ✗ Rejected:  1  (already answered by someone else)
```

List the uncertain/rejected items with their IDs and notes.

### Step 5 — Cleanup

```bash
rm -f /tmp/netclass-pending.json /tmp/netclass-answers.json /tmp/nc-q-*.png
```

## Rules

1. **Never submit an answer with confidence < 0.7** — flag it uncertain instead. Quality > throughput.
2. **If the question is ambiguous** (e.g., "describe your thoughts on X" — an essay question), skip with `note: "essay, needs manual review"`.
3. **If image download fails** (R2 403 or network), skip and note the reason. Don't guess without the image.
4. **Stop batch early** if > 3 consecutive items fail — server or queue is likely broken.
5. **Never modify the original pending queue** via SQL — only via `/admin/submit` API.
6. **Do not run autonomously on cron** — this command is always manually invoked.

## Troubleshooting

- `401 admin_required` — Admin key stale. `wrangler secret put ADMIN_KEY` on server, update env file.
- `503 on /admin/pending` — Server/D1 down. Check `wrangler tail`.
- `Read` cannot open PNG — `curl` returned HTML error page. Check R2 bucket public.
- Vision unclear on formula — composite image rendering bug in client. File a bug against `client/src/vision/compose.ts`.
