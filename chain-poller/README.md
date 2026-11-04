# Panini Chain Poller

Always-on worker that indexes the **Panini Blockchain** (Hyperledger Sawtooth) into
Supabase. It reads new blocks, decodes each `panini-cx-crypto` transaction into a
sale/transfer event, and upserts them to `chain_events`. This is our own
independent version of the data feed Diamond's tracker provides.

## How it works
1. Launches a real headless Chromium (Playwright) and navigates to the explorer
   API once to pass **Cloudflare** — a plain server `fetch` gets 403, a real
   browser passes the managed challenge.
2. Every `POLL_MS` it walks `/blocks` down from the head (the API returns at most
   **20 blocks per page**) to the `chain_sync` cursor, decoding each page
   (`panini-chain.mjs`) and upserting its events before reading the next.
3. Advances the cursor when it reaches it. If it can't get there in one tick
   (`MAX_PAGES`, default 150 pages = 3,000 blocks) it keeps a resumable backfill
   and continues next tick. More than `MAX_BACKFILL_BLOCKS` (15,000, ~1.5 days)
   behind = it backfills only that far and logs the skip.

## Prereqs
- Run `migrations/005_panini_chain.sql` in Supabase first (creates `chain_events`
  + `chain_sync`).

## Env vars
| var | required | default |
|---|---|---|
| `SUPABASE_URL` | yes | — |
| `SUPABASE_SERVICE_KEY` | yes | — |
| `PANINI_API` | no | `https://explorerapi.paniniamerica.net` |
| `POLL_MS` | no | `120000` (2 min; also the base of the failure back-off) |
| `MAX_PAGES` | no | `150` pages (x20 blocks) per tick |
| `MAX_BACKFILL_BLOCKS` | no | `15000` |
| `SELF_HEAL_AFTER` | no | `6` consecutive HTTP 403s, then exit so the host restarts the container (`0` = off) |
| `SELF_HEAL_MIN_UPTIME_MS` | no | `1200000` (20 min): never self-heal sooner than this after start |
| `PROXY_SERVER` / `PROXY_USER` / `PROXY_PASS` | no | residential proxy for the Cloudflare block |

## Deploy (Railway — easiest)
1. New Project → Deploy from GitHub repo → this repo.
2. Set the service **Root Directory** to `chain-poller`.
3. Add the env vars above (Supabase URL + service key).
4. Deploy. Start command is `npm start`; `postinstall` fetches the Chromium binary.
5. Watch logs — you should see `cursor X -> Y | events N (sales M)` each tick.

(Render / Fly / a $5 VPS work the same way: `cd chain-poller && npm install && npm start`.)

**Railway settings that matter** (Settings tab of the poller service):
- **Watch Paths = `/chain-poller/**`.** Without it every push to the repo (site pages, data files)
  redeploys the poller, and each redeploy is a fresh Cloudflare challenge. A burst of those trips
  Cloudflare's rate-based 403 wall (stalls on 2026-08-11, 09-04, 10-29 and 11-03).
- **Restart Policy = Always.** The poller now exits (code 1) after `SELF_HEAL_AFTER` consecutive
  HTTP 403s so the host restarts the container: in both cases we can see, a fresh container cleared
  the wall within 30-90 s while the in-process browser rebuild did not. With the default
  "On Failure" policy Railway stops restarting after its retry limit, which a long wall could hit.
- The back-off between failed ticks is 2, 4, 6, 8, 10 min (`POLL_MS` x failures, capped at 10 min),
  so the self-heal fires ~30 min into a wall, never sooner than `SELF_HEAL_MIN_UPTIME_MS` after start.

## Known risk — Cloudflare on datacenter IPs
This was verified working from an interactive browser. On a cloud host's
datacenter IP, Cloudflare *may* challenge harder (up to a click-CAPTCHA), which a
headless browser can't clear. If that happens, options are: a residential proxy,
or Diamond's peered-node route (`localhost:8008`, no Cloudflare) — the sturdier
long-term path. See `PROJECT_LOG.md`.

## Keep in sync
`panini-chain.mjs` here is a vendored copy of `tools/panini-chain.mjs` (kept local
so this folder deploys standalone). If you change one, change both.
