# Burning Edges — Pack Analytics Architecture

> **What this is:** a one-page snapshot of how the Panini NFT pack-pricing pipeline is wired.
> **Scope rule (keeps this from going stale):** this file describes the *stable shape* only —
> data flow, tables, functions, rules. It does NOT track prices, counts, EVs, or which cards
> moved — those live in the DB and on the live pages and change hourly. **Update this file only
> when the architecture changes** (a new product, table, function, or a rule change), not for
> routine repricing. The chronological "what happened when" narrative is `PROJECT_LOG.md`.

Last architecture change: 2026-10-31 (shared live-pack engine for Stickers / 2022 Prizm WC / 2022 Mosaic; poller resumable backfill).

---

## The products
| Product | `product` key | Chain prefix | Page | Engine | Runs |
|---|---|---|---|---|---|
| 2026 Prizm WC Soccer (base + FOTL) | — (`pbc_snapshots`) | `packcard-2332` | `/panini` | `pbc_engine.py` (manual/offline) | by hand |
| 2026 WC Floral Edition | `floral` | `packcard-2333` + `2332` | `/floral` | pack_values | every 5 min |
| 2026 WC Animal Print Edition | `animalprint` | `packcard-2332` | `/animalprint` | pack_values | every 5 min |
| 2026 WC Stickers | `stickers26` | `packcard-850180` | `/stickers` | live-pack | hourly |
| 2022 Prizm WC (BP store) | `prizmwc22` | `packcard-1733` | `/prizmwc22` | live-pack | hourly |
| 2022 Mosaic Road to WC | `mosaic22` | `packcard-1605` | `/mosaic22` | live-pack | hourly |
| 2021 NFL Prizm | `nflprizm21` | `packcard-1584` | `/nflprizm` | pack_values | hourly |
| Silhouette Basketball | `silhouette` | `packcard-2217` + `2305` | `/silhouette` | pack_values | hourly |
| Moonbirds | `moonbirds` | `packcard-850178` | `/moonbirds` | pack_values | hourly |

Hub: `/packs` (`packs-hub.html`: sport tabs + year filter, selection kept in the URL hash, e.g. `/packs#soccer/2022`).
Public change feed: `/changes`. Card lookup: `/value` (Price My Card).

Floral and Animal Print share prefix `packcard-2332` with the main soccer set, so their engines query
`chain_events` by the exact SKUs seeded in `pack_values`, never by prefix.

## Engine 1 — pack_values engines (NFL Prizm, Silhouette, Moonbirds, Floral, Animal Print)
```
Panini Sawtooth chain
   │  (Railway poller: headless browser past Cloudflare, reads every block)
   ▼
chain_events (every transfer, serial-tagged;      chain_pulls (pack opens: $0 transfers
              sales = price>0)                                 out of the pack vault)
   │                                                 │  → decrement_remaining() RPC
   │                                                 ▼
   │                                            card_remaining  (per-card "how many still sealed")
   ▼
{product}-refresh.mjs  — one pass:
   1. append new chain_events sales (time-bounded window) → pack_sales   (dedup = idempotent)
   2. reprice off pack_sales (recency rules) → pack_values   (persist changed only)
   3. notable moves → price_changes
   4. recompute snapshot from remaining × pack_values → {product}_snapshots (published row)
   ▼
/api/{product}-data  → the page (with baked FALLBACK_DATA + shape-check)
/api/changes         → /changes + the on-page feed on every pack page
/api/card-values     → /value search (NFL + Silhouette cards only)
```
**Remaining = serial deduction** (`tools/chain-serials.mjs`): every serial that leaves a pack shows up as a
`transfer_product` carrying its serial, so in-packs = {1..run} minus the serials seen moving.
- Small runs (Floral, Animal Print): `inPacksBySku` → the exact surviving serials, incl. whether #1 / last / jersey serials are still sealed.
- Big runs (NFL, Silhouette, Moonbirds): `reconciledRemainingByFilter` → min(run − serials moved, `card_remaining`), safe against historical poller gaps.
- Moonbirds is carved out of poller auto-decrement (`BRIDGE_PREFIXES`): bridging a card to Ethereum also sends it $0 from the vault and would look like a pack open. Its `card_remaining` is kept right by re-seeding.

## Engine 2 — live-pack engine (Stickers, 2022 Prizm WC, 2022 Mosaic)
```
Panini collection report (CSV, pulled by hand)  →  copies at report time in data/ JSON
                                                    (stickers26-checklist.json report_ts / <product>-cards.json pulls_from)
chain_events (sales)          chain_pulls (opens, read incrementally by id)
   ▼
{stickers,prizmwc22,mosaic22}-refresh.mjs  — HOURLY, shared tools/live-pack.mjs:
   1. load the product's state row from stickers_snapshots (first run seeds from the repo sales files)
   2. append chain sales since last_ts − 30 min (sku range, time-bounded, max 7 days back)
   3. append chain pulls since last_pull_id → copies pulled per sku since the report (#1 / last pulls tracked)
   4. run the model → save payload + state back to the same row
   ▼
/api/stickers-data (stickers26) · /api/pack-live?product=prizmwc22|mosaic22  → page + hub card
```
- Models: `tools/stickers-model.mjs` (stickers), `tools/card-pack-model.mjs` (both 2022 packs).
- Pages are rendered from `tools/packpage-template.html` by `python tools/build-pack-pages.py`, which bakes a fallback payload (via `node tools/stickers-build.mjs` / `node tools/card-pack-build.mjs`). The page swaps in live numbers and keeps the baked ones on any failure.
- State is the `sales` jsonb column: `{log, pulled, pullSpec, last_pull_id}`. The table name is historical — it holds every live pack.
- These engines do NOT write `price_changes`, so their moves don't appear on `/changes`.
- **Still manual (not on chain):** copies left / burn status (fresh collection report → update the data JSON and set `report_ts` / `pulls_from` to the report time) and pack floor / listings (`data/pack-markets.json`, `pack` in `stickers26-checklist.json`). Push → the next hourly run picks them up.

## Engine 3 — offline: 2026 Prizm WC (base + FOTL)
`pbc_engine.py` run by hand → `pbc_snapshots` (published-gated, payload + valuer) → `/api/pbc-data` → `/panini` (`packs.html`)
and the soccer side of `/value`. Data contract: `PBC_DATA_CONTRACT.md`. Not chain-wired.

## Repricing rules
**pack_values engines (the engine's contract):**
- **Recency:** last-3-months sales take precedence, widen to 6mo/12mo only if too thin (min 2 sales).
- **Sticky:** a price only moves on a real recent sale; otherwise it HOLDS. No stale all-time fallback (kills washes).
- **Owner anchors are floors** and are hard-held (never auto-dropped): e.g. Brady Gold $50k / #1 $150k, Mahomes Gold $30k (NFL); Cooper Flagg 1/1 $40k, /10 $7,500 (Silhouette).
- **Money cards** (Kaboom/Gold/GoldVinyl/Red for NFL; hits + scarce base for Silhouette) price straight to market, uncapped. **Wash-prone commons** stay capped.
- **Excluded noise:** #1 / last-serial / perfect-mint / jersey-mint from "ordinary"; challenge-corner farces (e.g. Landon Collins) and junk-transfer base overpays.
- **Premium serials are only #1 and #run** (not the last two). On the Floral / Animal Print board each special serial is its own row: #1 = 3×, last = 2×, jersey # = 2× the normal value.
- Named-serial grail premium (e.g. Brady Gold #1/10 $150k) is baked into pack EV in the *recompute*, not the reprice: group = (u−1)×normal + 1×premium, only if still sealed.

**live-pack models:**
- **Stickers:** overrides, rule switches, copies, burn status and the market snapshot all live in `data/stickers26-checklist.json` (`overrides`, `rules`, `pack`). The current rule set is whatever is in `rules` — read that file, not this doc. Special serials (#1 / last / jersey) are valued separately from normal serials. Packs = Silver copies in packs / 3.
- **2022 Prizm WC:** recent own-set chain sales first; otherwise 1.5× the same player's 2026 WC comp (precomputed from `burning_edges_sales_db.json` into `data/prizmwc22-cards.json`); scrub cap so one star sale doesn't price every common; grail overrides.
- **2022 Mosaic:** 2026 sales only; John's grail values.

## Supabase tables
- `chain_events` (every transfer; sales = price>0) · `chain_pulls` (opens) · `chain_sync` (poller cursor)
- `card_remaining` (sealed counts, decremented by pulls) · `decrement_remaining()` RPC
- `pack_values` (product, sku_base PK → value, meta) — the live per-card value map
- `pack_sales` (running sales log; `dedup` unique key) — seed history + appended chain sales
- `{nflprizm,silhouette,moonbirds,floral,animalprint}_snapshots` (published-gated payload the pages serve)
- `stickers_snapshots` — one row per live pack (`product` = stickers26 / prizmwc22 / mosaic22): payload + engine state
- `pbc_snapshots` — 2026 Prizm WC payload + valuer (published-gated)
- `price_changes` (the /changes feed)

**Query rules (the DB runs out of disk IO budget — learned 2026-10-30):**
- Always time-bound `chain_events` reads (refresh fns use 3h / 6h windows; live-pack uses last_ts − 30 min). Unbounded `order=ts.desc` scans starved the DB.
- Single-sku lookups: `sku_base=gte.X&sku_base=lte.X` (fast); `eq.` / `in.()` were much slower under load.
- CPU pinned with mostly IOwait = disk throttled → restart the project from the Supabase dashboard.

## The poller (`chain-poller/`, on Railway)
- Reads the Cloudflare-fronted explorer API with a real headless browser (Playwright; a plain fetch gets 403). Ticks every 2 min (`POLL_MS`).
- Walks **every block** from the `chain_sync` cursor to the head via `paging.next`. The API caps pages at 20 blocks (`PAGE_LIMIT` 20); `MAX_PAGES` 150 per tick (3,000 blocks). Each page is written before the next is read, and an unfinished backfill resumes next tick. `MAX_BACKFILL_BLOCKS` 15,000 (~1.5 days): blocks older than that after an outage are logged and skipped.
- Writes: upserts with `ignore-duplicates` in chunks of 100, checked and retried (`sbMust`); HTTP 429 retried with backoff.
- `panini-chain.mjs` decodes base64-JSON payloads; `blockPulls` = $0 `transfer_product` of a `packcard-` card **from the pack-vault wallet** (`PACK_VAULT`) = a pack open; Moonbirds excluded (`BRIDGE_PREFIXES`). Vendored copy must stay in sync with `tools/panini-chain.mjs`.
- Chain moves ~400 blocks/hr. `/blocks?start=0x<hex block>&limit=N` jumps to any block (debug / backfill). To backfill a hole, set `chain_sync.last_block_num` back to its start.
- **⚠ OPERATING RULES:**
  - Railway redeploys the poller on every push to this repo (until Watch Paths is set to `/chain-poller/**`). Each redeploy = a fresh Cloudflare challenge, and a burst trips a rate-based 403 block. Batch pushes into one and let it settle.
  - If it stalls anyway, ONE restart after some quiet time is the documented fix (2026-09-04 and 2026-11-03: recovered in 30-90 s); the in-process browser rebuild cleared it neither time. Repeated restarts are what to avoid. The poller now exits after 6 consecutive HTTP 403s (`SELF_HEAL_AFTER`, ~30 min of back-off) so the host restarts the container itself; that needs Railway's Restart Policy set to Always.
  - A stall that a redeploy doesn't fix → check Railway billing first (the 2026-09-09 stall was an expired trial).
  - `PROXY_SERVER` env hook exists for an *unprovoked* future block (residential proxy); not needed normally.

## Hosting
- Netlify auto-deploys every push to `main`, and every production deploy costs Netlify credits (they ran out 2026-10-30) → batch pushes.
- The site is public. The Basic-Auth gate (`netlify/edge-functions/site-gate.js`) was removed 2026-10-30; restore it from git history (before 23c593e) if a lock is wanted again.

## Key files
- Pages: `nflprizm.html`, `silhouette.html`, `moonbirds.html`, `floral.html`, `animalprint.html`, `stickers.html`, `prizmwc22.html`, `mosaic22.html`, `packs.html` (/panini), `packs-hub.html`, `changes.html`, `value.html`
- pack_values engines: `netlify/functions/{nflprizm,silhouette,moonbirds,floral,animalprint}-refresh.mjs` · reprice `tools/*-reprice.mjs` · recompute `tools/*-recompute.mjs` · seed value maps `tools/*-values.json` · serial deduction `tools/chain-serials.mjs`
- live-pack engine: `tools/live-pack.mjs` · models `tools/stickers-model.mjs`, `tools/card-pack-model.mjs` · functions `netlify/functions/{stickers,prizmwc22,mosaic22}-refresh.mjs` · data `data/stickers26-{checklist,cards,sales}.json`, `data/{prizmwc22,mosaic22}-cards.json`, `data/{prizmwc22,mosaicrtwc22}-sales.json`, `data/pack-markets.json` · page build `tools/build-pack-pages.py` + `tools/packpage-template.html`
- Serve/lookup: `netlify/functions/{nflprizm,silhouette,moonbirds,floral,animalprint}-data.js`, `stickers-data.js`, `pack-live.js`, `pbc-data.js`, `changes-data.js`, `card-values.js`
- Seeders: `tools/seed-remaining.mjs` (card_remaining), `tools/seed-pack-reprice.mjs` (pack_values + pack_sales), `tools/seed-moonbirds-*.mjs` + `tools/reseed-moonbirds-remaining.mjs`
- Migrations: `migrations/001`–`011`

## Known follow-ups (not yet done)
- `/value` only covers the soccer set + NFL + Silhouette (`card-values.js` reads `pack_values` for `nflprizm21,silhouette`). Moonbirds, Floral, Animal Print and the three live packs aren't searchable. (The 2026-08-24 log entry says Moonbirds landed in /value; the code doesn't include it.)
- Live-pack engines don't write `price_changes`, so Stickers / 2022 pack moves don't show on `/changes`.
- 2026 Prizm WC + FOTL are still priced offline by `pbc_engine.py` (not chain-wired).
- Moonbirds counts need re-seeding until the ETH-bridge transfer can be told apart from a pack open.
- Live packs: copies left / burn status and pack floors / listings are still entered by hand.
- Poller history has holes that were never written (2026-09-06→09-09, by decision 2026-09-14; 2026-10-06→10-28); outages beyond 15,000 blocks are skipped, not backfilled.
- Railway settings (John): Watch Paths = `/chain-poller/**` so site pushes stop restarting the poller, and Restart Policy = Always so the poller's self-heal exit is always restarted.
- Self-heal is untested against a real Cloudflare wall: unknown whether a crash-restart clears it as reliably as a full redeploy did. If not: Railway's redeploy API, or a residential proxy (`PROXY_SERVER`).
