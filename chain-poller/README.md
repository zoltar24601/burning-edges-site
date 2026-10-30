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
| `POLL_MS` | no | `30000` (30s) |
| `MAX_PAGES` | no | `150` pages (x20 blocks) per tick |
| `MAX_BACKFILL_BLOCKS` | no | `15000` |

## Deploy (Railway — easiest)
1. New Project → Deploy from GitHub repo → this repo.
2. Set the service **Root Directory** to `chain-poller`.
3. Add the env vars above (Supabase URL + service key).
4. Deploy. Start command is `npm start`; `postinstall` fetches the Chromium binary.
5. Watch logs — you should see `cursor X -> Y | events N (sales M)` each tick.

(Render / Fly / a $5 VPS work the same way: `cd chain-poller && npm install && npm start`.)

## Known risk — Cloudflare on datacenter IPs
This was verified working from an interactive browser. On a cloud host's
datacenter IP, Cloudflare *may* challenge harder (up to a click-CAPTCHA), which a
headless browser can't clear. If that happens, options are: a residential proxy,
or Diamond's peered-node route (`localhost:8008`, no Cloudflare) — the sturdier
long-term path. See `PROJECT_LOG.md`.

## Keep in sync
`panini-chain.mjs` here is a vendored copy of `tools/panini-chain.mjs` (kept local
so this folder deploys standalone). If you change one, change both.
