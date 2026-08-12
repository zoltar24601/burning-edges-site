# Burning Edges — Pack Analytics Architecture

> **What this is:** a one-page snapshot of how the Panini NFT pack-pricing pipeline is wired.
> **Scope rule (keeps this from going stale):** this file describes the *stable shape* only —
> data flow, tables, functions, rules. It does NOT track prices, counts, EVs, or which cards
> moved — those live in the DB and on the live pages and change hourly. **Update this file only
> when the architecture changes** (a new product, table, function, or a rule change), not for
> routine repricing. The chronological "what happened when" narrative is `PROJECT_LOG.md`.

Last architecture change: 2026-08-11 (auto-reprice engine + Price My Card).

---

## The products
| Product | `product` key | Chain prefix | Page | Values source |
|---|---|---|---|---|
| 2021 NFL Prizm | `nflprizm21` | `packcard-1584` | `/nflprizm` | `pack_values` (auto-reprice) |
| Silhouette Basketball | `silhouette` | `packcard-2217` + `2305` | `/silhouette` | `pack_values` (auto-reprice) |
| Moonbirds | `moonbirds` | `packcard-850178` | `/moonbirds` | Diamond's Tracker API (offer-floor rules) |
| Soccer (Prizm) | — | `packcard-2332` | `/panini`, `/packs` | `pbc_engine.py` (manual/offline) |

Hub: `/packs`. Public change feed: `/changes`. Card lookup: `/value` (Price My Card).

## Data flow (NFL Prizm + Silhouette — the auto-reprice packs)
```
Panini Sawtooth chain
   │  (Railway poller: headless browser past Cloudflare, reads /blocks)
   ▼
chain_events (sales, price>0)     chain_pulls (pack-opens, $0 transfers in a burn block)
   │                                   │  → decrement_remaining() RPC
   │                                   ▼
   │                              card_remaining  (per-card "how many still sealed")
   ▼
{product}-refresh.mjs  — HOURLY engine, one pass:
   1. append new chain_events sales  → pack_sales   (dedup = idempotent)
   2. reprice off pack_sales (recency rules) → pack_values   (persist changed only)
   3. notable moves → price_changes
   4. recompute snapshot from card_remaining × pack_values → {product}_snapshots (published row)
   ▼
/api/{product}-data  → the page (with baked FALLBACK_DATA + shape-check)
/api/changes         → /changes + the on-page feed on every pack page
/api/card-values     → /value search (NFL + Silhouette cards)
```
Counts track the chain automatically; values reevaluate off real sales; nothing manual per cycle.

## Repricing rules (the engine's contract)
- **Recency:** last-3-months sales take precedence, widen to 6mo/12mo only if too thin (min 2 sales).
- **Sticky:** a price only moves on a real recent sale; otherwise it HOLDS. No stale all-time fallback (kills washes).
- **Owner anchors are floors** and are hard-held (never auto-dropped): e.g. Brady Gold $50k / #1 $150k, Mahomes Gold $30k (NFL); Cooper Flagg 1/1 $40k, /10 $7,500 (Silhouette).
- **Money cards** (Kaboom/Gold/GoldVinyl/Red for NFL; hits + scarce base for Silhouette) price straight to market, uncapped. **Wash-prone commons** stay capped.
- **Excluded noise:** #1 / last-serial / perfect-mint / jersey-mint from "ordinary"; challenge-corner farces (e.g. Landon Collins) and junk-transfer base overpays.
- Named-serial grail premium (e.g. Brady Gold #1/10 $150k) is baked into pack EV in the *recompute*, not the reprice: group = (u−1)×normal + 1×premium, only if still sealed.

## Supabase tables
- `chain_events` (sales) · `chain_pulls` (opens) · `chain_sync` (poller cursor)
- `card_remaining` (sealed counts, decremented by pulls) · `decrement_remaining()` RPC
- `pack_values` (product, sku_base PK → value, meta) — the live per-card value map
- `pack_sales` (running sales log; `dedup` unique key) — seed history + appended chain sales
- `{moonbirds,silhouette,nflprizm}_snapshots` (published-gated payload the pages serve)
- `price_changes` (the /changes feed)

## The poller (`chain-poller/`, on Railway)
- Reads the Cloudflare-fronted explorer API with a real headless browser (a plain fetch gets 403).
- `panini-chain.mjs` decodes base64-JSON payloads; `blockPulls` = $0 `packcard-` transfers in a block that has a `burn_product` (a pack open). Vendored copy must stay in sync with `tools/panini-chain.mjs`.
- **⚠ OPERATING RULE:** do NOT rapid-fire deploys that touch the poller — each redeploy restarts the browser = a fresh Cloudflare challenge, and a burst trips a rate-based 403 block. Batch poller changes into ONE push and let it settle. `PROXY_SERVER` env hook exists for an *unprovoked* future block (residential proxy); not needed normally.

## Key files
- Pages: `nflprizm.html`, `silhouette.html`, `moonbirds.html`, `packs-hub.html`, `changes.html`, `value.html`
- Hourly engines: `netlify/functions/{nflprizm,silhouette}-refresh.mjs`
- Reprice modules: `tools/{nflprizm,silhouette}-reprice.mjs` · recompute: `tools/{nflprizm,silhouette}-recompute.mjs`
- Value maps (seed): `tools/{nflprizm,silhouette}-values.json` · sales seed: `tools/nflprizm-sales-seed.json`
- Serve/lookup: `netlify/functions/{nflprizm,silhouette}-data.js`, `changes-data.js`, `card-values.js`
- Seeders: `tools/seed-remaining.mjs` (card_remaining), `tools/seed-pack-reprice.mjs` (pack_values + pack_sales)
- Migrations: `migrations/00{5,6,7,8}_*.sql`

## Known follow-ups (not yet done)
- Moonbirds not yet in `/value` (its values live in the moonbirds snapshot, not `pack_values`).
- Soccer reprice still the separate Python `pbc_engine` (not chain-wired).
- Poller catch-up uses a fixed `LOOKBACK=40`, so a long stall skips blocks (won't backfill).
