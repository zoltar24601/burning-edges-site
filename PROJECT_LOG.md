# Burning Edges — Master Project Log

**Purpose:** Single source of truth for all Burning Edges projects. Written so a fresh chat, Claude Code, or future-me can pick up cold without re-deriving decisions from chat history. Update as work happens; the repo copy is canonical.

**Site:** burningedgesdfs.com (Netlify static, drag-drop deploy) · **Repo:** `zoltar24601/burning-edges-site` · **Backend:** Supabase · **Stack:** vanilla HTML/CSS/JS · **Owner:** John

**Last updated:** 2026-07-31

---

## How to use this doc

- **Two-track workflow:** *This chat interface* handles pricing runs and data judgment (parsing sales, dedup, valuation calls). *Claude Code* (running locally against the repo) handles backend/plumbing (engine commits, Supabase wire-up, deploys, optimizer work).
- **Canonical rule:** The **repo** is the source of truth for code (engine, pages, functions) AND for this doc. When a pricing decision is made in chat, it lands here. When Claude Code changes the backend, that lands here too. One writer at a time to avoid drift.
- **The failure mode this doc prevents:** decisions and logic living only in chat history, so a too-full-chat handoff loses the *why*. Every non-obvious call goes in the Decision Log below with a date.

---

## Design system (shared across projects)

- Dark pine-green palette: `#061F18` / `#0A2B21`, cream `#EDE7D5`, accent greens/ambers/reds
- Golf-specific: fairway-neon `#B8F04A`, amber `#F2C14E`, red `#E5604C`
- Barlow Condensed Bold headers
- Twitter-ready graphic output sizing (golf: 1600×1000px)
- **GOTCHA:** Keep function/text files ASCII-only — em-dashes corrupt GitHub web-editor pastes. Function files need explicit `.js` extensions.

---

# PROJECT 1 — PBC (Panini Blockchain) Analytics — 2026 Prizm World Cup Soccer

The flagship. Pricing engine + pack EV + Value My Card + whale tracker for 2026 Prizm World Cup Soccer NFTs.

## Current state (as of last pricing run, 2026-07-31)
- **Pack counts:** 7,217 base / 2,141 FOTL remaining (typed in this run; ~40% of base / ~47% of FOTL packs opened since 07-09)
- **Book value:** base $88.96 → predicted ~$222 · FOTL $139.43 → predicted ~$349
- **Methodology (changed this run):** CLEAN canonical `pbc_engine.py` output — persistent overrides applied (Messi Gold /10 $50k, Mbappe Black/Nebula /1 $60k), but **NO stale offers file and NO +10% Messi/Mbappe/Yamal bump** (both were wrapper-only, not in the engine). The prior 07-09 live number ($127 → $318) used with-offers + the bump; John chose the clean version on 2026-07-31 (offers file 5 weeks stale; "arguably more honest"). So part of the $127→$89 drop is packs sold, part is this methodology change.
- **Mint:** base $25 / FOTL $150 · **Insert odds:** 35% · **Predicted multiplier:** 2.5x
- **Sales DB:** 14,848 unique sales (`burning_edges_sales_db.json`), unchanged this run (no new sales files sent — only remaining counts updated from the report)
- **Current report:** Panini Collection Report `__15_`, **White Sparkle rows excluded** (separate pack product — do NOT include in the calc). Typed-in pack counts authoritative over report-implied.
- **Published as:** `pbc_snapshots` id=11 (`published=true`; id=10 retired) — first live run through the publish-gated workflow.

## Files / artifacts
- `pbc_engine.py` — **self-contained pricing engine.** Reads sales JSON + collection report CSV, outputs data for pages. **COMMITTED to the repo 2026-07-31** (verified: compiles clean + runs end-to-end before commit; the Messi Gold /10 $50k and Mbappe Base Black/Nebula /1 $60k overrides are now version-controlled here, ending the loose-file/stale-copy risk). (was previously loose-file, re-uploaded each session — that caused stale-copy risk). Run: `python3 pbc_engine.py <sales_db.json> <report.csv> <base_packs> <fotl_packs> <offers.json>`
- `burning_edges_sales_db.json` — all recorded marketplace sales; the one file that must carry across chats. **COMMITTED to the repo 2026-07-31** (14,848 sales; verified valid JSON before commit).
- `offers_2026-06-22.json` — stale standing-offers snapshot (optional 5th arg; drives with-offers model)
- `PBC_DATA_CONTRACT.md` — data contract explaining engine internals + field meanings
- Pages (all live): `packs.html` (pack EV / predicted price, Customize mode), `value.html` (Value My Card w/ derivation + comps + serial tiers), `top.html` (Buyers & Sellers whale tracker), `pbc.html` (hub), `index.html`, `start.html`
- `pbc-data.js` — Netlify serverless function, live at `/api/pbc-data`

## Pricing engine logic (preserve this)
- **Pools:** silver (Base Silver) · nonsilver (Black/Gold/Blue/Red/Cracked Ice/Zebra) · insert (everything else) · fotl (Nebula/Aguila/Maple Leaf/Old Glory — FOTL-exclusive)
- **Base EV** = 2×silver + nonsilver + (0.65×nonsilver + 0.35×insert). **FOTL EV** = fotl_pool/fotl_packs + base_ev
- **Tiers:** MEGA = Messi, Yamal. ELITE = Ronaldo, Maradona, Mbappe, Haaland, Olise
- **Priority cascade:** mega base ladder (real sales) → special serials → per-copy overrides → gold /10 floor (mega $8k / elite $3k / standard = normal floor) → real sale median → premium-sale fallback (only-premium-sales: run==1 uses full value, run>1 uses premium×0.66) → rarity floors
- **Transfer filter (critical):** drop sales ≤$5, any /1 chase under $30, low-run chase under $15 — these are $1 self-transfers exploiting Panini's 7-day gift-lock. (~4,480 transfers removed in current data; 14,848 raw → ~7,937 used.)
- **Global dedup** on (athlete, cardset, serial#, price, premium) — sales files are rolling windows with heavy overlap
- **Real sales beat stale offers** for everything except mega 1/1s
- Reads `UNCLAIMED` column from collection reports (still-in-pack count). `poolCopiesTotal` is raw UNCLAIMED — no scaling. Pack counts are **typed in**, not derived from the report.
- `updated` date auto-sets to today

## Active manual adjustments (IMPORTANT — read before every run)
| Adjustment | Value | Where | Persists? |
|---|---|---|---|
| Messi Gold base /10 | $50,000 (final) | engine `GOLD_OVERRIDE` | ✅ persists (in engine) |
| Mbappe Base Black /1 | $60,000 (final) | engine `PERCOPY_OVERRIDE` | ✅ persists (in engine) |
| Mbappe Nebula /1 | $60,000 (final) | engine `PERCOPY_OVERRIDE` | ✅ persists (in engine) |
| Messi/Mbappe/Yamal blanket | +10% each run | **wrapper only, NOT engine** | ⚠️ **REVERTS on update unless reapplied** |

- The three engine overrides are **excluded from the +10% bump** (they're already final). Everything else for those three players still gets +10%.
- **OPEN QUESTION:** should the +10% be persisted into the engine as a per-player multiplier so it stops reverting? Not yet decided.

## Standing to-dos (PBC)
1. **[DONE] Step 5 wire-up** — make pages fetch from Supabase `/api/pbc-data` instead of baked-in DATA blocks, so an update = one SQL insert, no HTML paste. **DONE — merged to main and LIVE 2026-07-31 (commit 9cb8c7a). Migration run (published column added; current snapshot id=10 published, no dark window). Verified on the live deploy: packs shows Base ~$318 with overrides, value search works, both served through the `published` filter. Field contract in `PBC_DATA_CONTRACT.md`.** Verified: live endpoint returns exact shapes (payload keys <-> packs.html `DATA`; valuer `{cards,comps}` <-> value.html), 5-min CDN cache, and the served data equals the baked 2026-07-09 run (no surprise change). Approach: replace `const DATA` with `let DATA=null`, move synchronous init (cardPrices/tailPrices/cfg + first `render()`) into an `init()` run after a `fetch('/api/pbc-data?type=calc')`; value.html does the same for `cards`/`comps` via `?type=valuer`; leave calc/search/edit logic and `SPECIAL_SERIALS`/`JERSEY` untouched. Decisions (locked by John 2026-07-31): baked last-known `FALLBACK_DATA` (NOT banner-only) so a public page is never blank; a `published` boolean column + function filter (workflow: compute -> inspect -> flip `published`, preserving the review gate); branch/preview deploy only, never straight to main; PLUS a payload shape-check in `boot()` on both pages, so a future engine field rename hits the fallback instead of throwing in render(). Hard gate: engine had to be committed before merge (done, commit e6e054f). Risks to watch: async-init ordering; no review gate (any insert goes live within 5 min); output-contract coupling (engine must keep emitting these field names). *(Claude Code task.)*
2. Deploy `top.html` + `/top` route. *(Claude Code task.)*
3. Considered reframing packs page around **median** (~$22, 56% under mint) instead of **mean** — decision pending.

## Update routine (PBC)
Send new tier sales files (epic / ultra_rare / rare / uncommon / legend) + usually a collection report CSV + remaining pack counts → parse new sales, add to DB, re-run engine.

**New publish-gated flow (since Step 5, 2026-07-31 — no more HTML paste):**
1. Run `pbc_engine.py` → get `pbc_snapshot_insert.sql`; insert the snapshot. It lands `published=false`, so it is **invisible** to the live pages.
2. **Inspect** the new snapshot (numbers, overrides).
3. `update pbc_snapshots set published=true where id=<new_id>;` → live within the 5-min CDN cache. The pages fetch it automatically; nothing else to deploy.
4. Roll back by flipping the previous row back to `published=true` (or the new one to false).
5. Occasionally refresh each page's baked `FALLBACK_DATA` with a known-good payload — it's only the disaster floor, not the update path.

## GOTCHAS (PBC)
- **Comps-vs-manual-value gap:** value.html shows offer/sale comps next to assigned values. When a value is manually overridden well above visible comps, the page can look self-contradictory. Consider suppressing comps or labeling "manual valuation" on overridden cards.
- **Stale-engine risk:** if a session runs the *old* engine, the $50k/$60k overrides vanish. Mitigated 2026-07-31: the canonical engine (carrying the $50k/$60k overrides) is now committed in the repo — always run the repo copy.
- **`re.sub` escape bug:** card data contains `\u` unicode escapes; use literal string splicing (find markers, slice) to swap DATA blocks, not regex replacement.
- **Report column naming:** engine handles both `CARD SET` (with space) and `CARDSET`.

## History / investigations
- **Pack-peeking exploit (June 2026):** investigated whether PBC packs are vulnerable to peeking exploits seen in other NFT products. Determined **inapplicable** — PBC runs on Hyperledger Sawtooth (permissioned private ledger). Only residual vector is a client/API-layer leak, which would be a TOS violation. Proposed empirical correlation test (pack SKUs vs. card SKUs pulled) to check for patterns.

---

# PROJECT 2 — Moonbirds ("Birbs Beyond") — NEW, 2026-07-31

Brand-new Panini NFT drop. **First-ever Panini Moonbirds product — no secondary market history exists.** Art/PFP NFT, not sports.

## Status: LIVE PUBLIC PAGE (built 2026-07-31 on branch `moonbirds-page`, pending merge)
Was tracking-only; now a public pack-pricing page at **/moonbirds** (`moonbirds.html`), modeled on `packs.html`. Architecture = **Option A** (same as PBC Step 5): the page fetches `/api/moonbirds-data` (function `moonbirds-data.js`) which serves the newest **published** row of a new **`moonbirds_snapshots`** table (publish gate), with a baked `FALLBACK_DATA` disaster floor + `boot()` shape-check. Data lives in `moonbirds_pricing.json` (the baked fallback AND the payload inserted to Supabase). Table DDL: `migrations/002_moonbirds_snapshots.sql` (John runs once; Claude cannot run DDL over the service key). NOT merged to main yet. Still NOT run through `pbc_engine.py` (different pools/tiers/logic).

## Set structure (from checklist `2026_Panini_NFT_Moonbirds_-_Birbs_Beyond.csv`)
- **25 characters** (Kenji, Ferno, Merlin, Enlightened Professor, etc.) — not athletes
- **133 cards total**
- Parallels & print runs:
  - Base: Black /1 · Holo Gold /10 · Purple /25 · Red /49 · Blue /99 · Silver /194 (20 cards each)
  - Kaboom inserts: Green /1 · Gold /10 · base /25 (4 cards each)
  - **Birbhalla /49** — the grail; single card (Enlightened Professor), 49 copies

## Pricing: now first-day-sales-informed (2026-07-31)
Was offers-only. On 2026-07-31, **41 first-day sales** drove a repricing (full values in `moonbirds_pricing.json`). Key moves: Holo Gold /10 floor $50 -> $300 (serial #2 sold $250 & $500); Kaboom /25 floor $250 -> $500 (one $1k mid-serial sale, thin); Birbhalla floor $1,000 -> $450 (ordinary sold $230-499); special serials up (Silver #1 $180, Blue #99 perfect-mint $250, Purple #1 $150). **Kaboom Gold #1 kept at $2,000 per John despite a $1,000 sale** (clears-above-offers). Pack model: 2 cards/pack, mint $50, pull odds exact (print-run population); **pack book EV = $102.51 (2.05x mint)**, predicted ~$256 @2.5x (borrowed multiplier, labeled speculative, not a market figure). Pack count NOT yet updated (3,233 left per John; per-parallel remaining counts pending -> odds still on original 3,873 population).

**Valuation principle (John, market expert):** cards clear ABOVE offers; scarce serials priced above the visible book on a fresh drop.

**Market-anchored now:** 8 of 10 tiers have real 7-31 sales/offers; only **Base Black /1** and **Kaboom Green /1** are pure estimates. Caveat still holds: fresh product, scarce-serial premiums are directional -> revisit as more sales accumulate.

## Values (full board in `moonbirds_pricing.json` -> tier_rules + priced_cards)
Per-parallel floor + #1/last-serial breakouts, expanded on the page. Birbhalla: #1 $10,000 / floor $450 / #49 $5,000. Kaboom Gold: #1 $2,000 / floor $1,000 / #10 $2,000. Top slot-2 EV contributors: Holo Gold ($18/pack), Kaboom ($14), Kaboom Gold ($12), Base Black ($10), Birbhalla ($9).

## Still needed for Moonbirds
- **Remaining per-parallel pack counts** (John pulling) -> refine pull odds + show "packs left".
- Real sales/offers for **Base Black /1** and **Kaboom Green /1** (still pure estimates).
- Run `migrations/002_moonbirds_snapshots.sql`, then Claude inserts + publishes the payload, then merge the branch.

---

# PROJECT 3 — MLB DFS

## Data-loading infrastructure rebuild - DONE and live (verified against code 2026-07-31)
NOTE: the MLB loaders live in a SEPARATE repo, `zoltar24601/edge-dfs-loader` (GitHub Actions -> Supabase), NOT in burning-edges-site. The app UI is `mlb.html` in this repo.

- **Daily pipeline** (`.github/workflows/daily-loader.yml`, cron 6am UTC): `results-backfill.js` -> `hitter-loader-v3.js` -> `pitcher-loader-v4.js` -> `catcher-loader.js`.
- **Hitter side:** `hitter-loader-v3.js` is CURRENT (~10 min). Ingests missing dates into `edge_statcast_daily` (1 bulk Savant CSV per date, self-healing from the max stored game_date), then computes pitch splits (2025+2026), L7/L14/L28/season windows, hot score, emerging/cooling flags FROM the table. Writes `edge_matchup_cache` (vsR/vsL) + `edge_hot_history`. Replaced the retired 90-min per-player crawler `hitter-loader.js` (kept as rollback only).
- **Pitcher side (was entirely missing from this log):** `pitcher-loader-v4.js` is CURRENT, in the daily pipeline since 2026-07-10 (~3 min vs the old 66). Incremental on the twin table `edge_statcast_pitch_daily`; writes `edge_pitcher_cache`. Replaced retired `pitcher-loader.js` (rollback only). v4 arsenals are regular-season only by design (old loader included spring/postseason).
- **Tables:** `edge_statcast_daily` (hitter) + `edge_statcast_pitch_daily` (pitcher twin; adds velo_sum/velo_n). One row per player/pitcher + game_date + hand/side + pitch_type. **Raw COUNTS and SUMS only, never averages** -> any window/split rebuilds exactly by summing rows; rates computed at read time. Backfilled 2025-03 -> present, **regular season only (hfGT=R)**.
- **Schema-v2 columns (verified present in loader code):** singles, doubles, triples, home_runs, hbp, la_sum, la_n, fb_bip, bip_typed, zone_swing -> outcome wOBA, average launch angle, fly-ball %.
- **Backfill scripts (complete, not "in progress"):** `statcast-backfill.js` (hitter) and `pitcher-statcast-backfill.js` (pitcher) - date-range, one bulk Savant CSV per date, idempotent upserts, safe to re-run any range.
- **Architecture rules (from the loaders):** counts-not-averages; bulk-per-date, never per-player (per-player crawls caused the old 60-90 min runs); idempotent upserts with explicit on_conflict; per-item try/catch so one player/date failure never kills a run; self-healing ingest.
- **Supporting loaders:** `catcher-loader.js`, `results-backfill.js`, `park-factors-loader.js`, `fangraphs-loader.py`, `clear-hitters.js`, `dump-pitcher-cache.js`.
- **Manual-dispatch workflows:** `hitter-loader-v3.yml`, `pitcher-loader-v4.yml`, `statcast-backfill.yml`, `pitcher-backfill.yml`. Secrets: SUPABASE_URL, SUPABASE_KEY (service role).
- **GOTCHA:** GitHub disables scheduled workflows after 60 days of repo inactivity - if daily runs stop, re-enable in the Actions tab.

## Standing to-dos (MLB)
- **Branch-and-bound pruning** for the MLB optimizer in `mlb.html` - logged as designed but not yet built. (Could not verify in code; carried over as a planning item.)

## History
- Origins (early 2026): first Burning Edges tool - baseball DFS matchup tool (weighted wOBA by pitch type + hot-streak scorer). Established the core stack (vanilla HTML/CSS/JS + Supabase + Netlify) used by all later projects.

---

# PROJECT 4 — Golf DFS

## Tools (all in THIS repo: `golf.html` + `netlify/functions/` + `uploads.html`)
- **Cut-survival public page (`golf.html`)** - the live public tool (the "cut-probability page" and "cut-survival tool" in the old log are the same page). 50/50 side-by-side desktop layout (`.split` flexbox, two equal result cards: field distribution + "Find My Lineup"); stacks vertically at the 880px breakpoint. Two DataGolf-driven modes: **LIVE** = Poisson-binomial survivor distribution over DataGolf make-cut odds, averaged across all contest teams; **FINAL** = actual survivor count per team after the 36-hole cut. First run was RBC Canadian Open (June 2026); the page is generic/live per event.
- **"Find My Lineup"** - enter a DK username; ranks all that user's lineups by expected survivors, with clean-sweep / wipeout %.
- **Netlify functions:**
  - `golf-cut.js` (/api/golf-cut) - field cut-survival distribution per contest (up to 3) vs shared DataGolf make-cut odds; 30-min throttle so public traffic never hits DataGolf's 45 req/min limit.
  - `golf-field.js` (/api/golf-field) - raw DataGolf in-play field feed (positions, scores, cut/win/top-N odds); module-scope cache; deliberately NOT cached in `golf_distribution`.
  - `golf-lookup.js` (/api/golf-lookup?user=) - finds a DK username's entries (case-insensitive exact match) in the stored event, computes each lineup's cut-survival odds, returns them ranked by expected survivors. Fire-and-forget analytics log to `golf_lookups` (never blocks the user's result).
  - `golf-upload.js` (/api/golf-upload, POST, private) - accepts a gzipped, dictionary-encoded payload (handles 100K+ lineups); stores the compact encoded form (dict + index arrays) in Supabase; `gunzipSync`.

## Technical notes / gotchas (Golf)
- **Large-upload handling (`uploads.html` + `golf-upload.js`):** browser-side dictionary-encode + gzip via `CompressionStream` before POST, to stay under Netlify's ~6MB function request limit; the server detects gzip by magic bytes `0x1f 0x8b` (not headers) then `gunzipSync`s. (This is the "U.S. Open upload fix"; originally cut a ~16MB payload to <1MB.)
- **Lineup parsing (`uploads.html`):** `splitLineup()` splits a DK lineup string on the `G ` position markers (regex `/(?:^|\s)G\s/`), trims, and drops blanks.
- **CORRECTION (2026-07-31):** the previously logged `utf-8-sig` / `abbr()` / manual "F. Last" fix-dict parsing conventions are NOT present anywhere in the committed repo. Current name-matching (`golf-lookup.js`) is case-insensitive on stored lineup names vs DataGolf `player_name`. If those Python-side conventions still exist, they live in an uncommitted prep step, not this repo.
- `golf_lookups` analytics table is written fire-and-forget by `golf-lookup.js`. (RLS is a Supabase table-level setting, not verifiable from repo code.)

---

# Cross-project standing decisions
- **Documentation practice (2026-07-31):** maintain this master log as work happens, committed to the repo as canonical, to make chat handoffs clean. Pricing decisions from chat + backend changes from Claude Code both land here.
- **Engine-in-repo (DONE 2026-07-31):** `pbc_engine.py` and `burning_edges_sales_db.json` are committed in the repo, ending the loose-file re-upload / stale-copy risk. The $50k/$60k overrides are version-controlled. Engine was verified (compiles + runs end-to-end) before committing.

---

## Changelog
- **2026-07-31 (Moonbirds page built)** — Built the Moonbirds pack-pricing page at /moonbirds on branch `moonbirds-page`, Option A architecture (new `moonbirds_snapshots` table + `/api/moonbirds-data` function + published gate + baked fallback + boot() shape-check), a sibling of packs.html. Repriced from 41 first-day sales: pack book EV $102.51 (2.05x mint); Holo Gold/Kaboom floors up, Birbhalla floor down, Kaboom Gold #1 held at $2k per John. QA passed (EV display, Kaboom Gold/Birbhalla tier expansion, 8 market / 2 estimate badges, fallback render). NOT merged - pending John running `migrations/002_moonbirds_snapshots.sql` + reviewing the preview, then Claude inserts+publishes.
- **2026-07-31 (direct DB writes enabled)** — Claude can now read+write `pbc_snapshots` directly via the service-role key, through `tools/pbc-db.mjs` (key lives only in `~/.burning-edges/supabase.env`, gitignored/outside repo, never printed). MCP OAuth write path abandoned — removing `read_only` from the URL just broke the MCP connection (needs re-auth; same wall as 2026-07-10). Future pricing publishes are Claude end-to-end: engine → `pbc-db.mjs insert <calc> <valuer>` → show numbers → `pbc-db.mjs publish <id>`. No more SQL paste.
- **2026-07-31 (pricing run — report #15)** — First live pricing update via the new publish-gated workflow. Re-priced on report #15 (White Sparkle rows excluded — separate pack), pack counts 7,217 base / 2,141 FOTL. Clean canonical engine (no offers, no +10% bump — John's call). Base book $88.96 → ~$222, FOTL $139.43 → ~$349 (down from $127/$318: ~40% of packs opened + the methodology change). Inserted as `pbc_snapshots` id=11 (`published=false`) → verified shape/numbers → flipped to `published=true`, id=10 retired. Verified live on packs.html (base ~$222, updated 2026-07-31).
- **2026-07-31 (Step 5 LIVE)** — Merged `step5-supabase-wireup` → main (commit 9cb8c7a); packs.html/value.html now serve from Supabase via the `published`-filtered `/api/pbc-data`, with a baked `FALLBACK_DATA` disaster floor + boot() shape-check. Ran migrations/001 (published column added; current snapshot id=10 published — no dark window). Verified on the live deploy: packs Base ~$318 with overrides, value search works, both through the filter. Update routine is now publish-gated (insert `published=false` → inspect → flip to true; no HTML paste).
- **2026-07-31 (Step 5 built on branch)** — Implemented the Supabase wire-up on branch `step5-supabase-wireup` (NOT merged). packs.html/value.html now fetch `/api/pbc-data` and fall back to a baked `FALLBACK_DATA` on fetch/shape-check failure; `boot()` validates payload shape first. Function filters `published=eq.true`; added `migrations/001_pbc_published.sql` (publish gate) and `PBC_DATA_CONTRACT.md` (field contract). QA passed: live==baked numbers, both pages render from fetch, forced failure falls back cleanly. Pending: John's diff review → run migration → merge.
- **2026-07-31 (engine committed)** — Added `pbc_engine.py` (canonical, with Messi Gold /10 $50k + Mbappe Base Black/Nebula /1 $60k overrides) and `burning_edges_sales_db.json` (14,848 sales) to the repo. Verified before commit: engine compiles clean and runs end-to-end (BASE ~$92 book), overrides confirmed in output. Flipped all engine-location + sales-DB lines from PENDING to committed; the earlier PENDING correction is now resolved.
- **2026-07-31 (Step 5 plan)** — Reviewed `pbc-data.js` + `packs.html` + `value.html` + the `pbc_snapshots` schema for the Supabase wire-up. Confirmed stored `payload`/`valuer` shapes exactly match the pages and the live endpoint serves them (5-min cache). Plan approved and recorded in PBC standing to-dos; implementation deferred (not urgent). No code changed.
- **2026-07-31 (log review)** — Reviewed MLB + Golf sections against actual code. MLB: rebuild is DONE and live (daily-loader.yml runs hitter-loader-v3 + pitcher-loader-v4); documented the pitcher-side rebuild (pitcher-loader-v4 + edge_statcast_pitch_daily twin table) that was missing; noted loaders live in the separate edge-dfs-loader repo; verified schema-v2 columns. Golf: confirmed golf.html cut-survival page + 4 Netlify functions (golf-cut/field/lookup/upload); corrected the utf-8-sig/abbr/fix-dict "parsing conventions" (not present in the repo); documented the actual splitLineup + CompressionStream/magic-byte upload path.
- **2026-07-31 (correction)** — Corrected engine-location claims: `pbc_engine.py` verified NOT in the repo and not present anywhere on the machine; `burning_edges_sales_db.json` exists only in Downloads. Changed all engine-in-repo statements to PENDING COMMIT. The earlier "engine-in-repo migration" note (same day) was premature.
- **2026-07-31** — Created master log. Started Moonbirds tracking (Birbhalla serial tiers set). Established doc-as-canonical practice. Noted engine-in-repo migration.
- **2026-07-09** — PBC pricing run: 11,950 base / 4,030 FOTL. Added Messi Gold base $50k + Mbappe Black/Nebula /1 $60k as persistent engine overrides. Applied +10% Messi/Mbappe/Yamal (output-only).
- **~2026-07-01** — Prior PBC baseline: 18,476 base / 5,365 FOTL; sales DB at 14,848; engine + data contract established.
