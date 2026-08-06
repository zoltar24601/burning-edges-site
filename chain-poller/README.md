# Panini Chain Poller

Always-on worker that indexes the **Panini Blockchain** (Hyperledger Sawtooth) into
Supabase. It reads new blocks, decodes each `panini-cx-crypto` transaction into a
sale/transfer event, and upserts them to `chain_events`. This is our own
independent version of the data feed Diamond's tracker provides.

## How it works
1. Launches a real headless Chromium (Playwright) and navigates to the explorer
   API once to pass **Cloudflare** — a plain server `fetch` gets 403, a real
   browser passes the managed challenge.
2. Every `POLL_MS` it reads `/blocks?limit=LOOKBACK`, keeps blocks newer than the
   `chain_sync` cursor, decodes them (`panini-chain.mjs`), and upserts events.
3. Advances the cursor so nothing is missed or double-counted.

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
| `LOOKBACK` | no | `40` blocks scanned per poll |

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
