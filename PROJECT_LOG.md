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

## Current state (as of last pricing run, 2026-07-09)
- **Pack counts:** 11,950 base / 4,030 FOTL remaining
- **Book value:** base $127.17 → predicted ~$318 · FOTL $203.59 → predicted ~$509 (with-offers model, incl. active bumps/overrides)
- **Mint:** base $25 / FOTL $150 · **Insert odds:** 35% · **Predicted multiplier:** 2.5x
- **Sales DB:** 14,848 unique sales (`burning_edges_sales_db.json`), through ~July 1 2026
- **Current report:** Panini Collection Report `__13_` (typed-in pack counts are authoritative over report-implied counts)

## Files / artifacts
- `pbc_engine.py` — **self-contained pricing engine.** Reads sales JSON + collection report CSV, outputs data for pages. **NOW LIVES IN THE REPO** (was previously loose-file, re-uploaded each session — that caused stale-copy risk). Run: `python3 pbc_engine.py <sales_db.json> <report.csv> <base_packs> <fotl_packs> <offers.json>`
- `burning_edges_sales_db.json` — all recorded marketplace sales; the one file that must carry across chats
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
1. **Step 5 wire-up** — make pages fetch from Supabase `/api/pbc-data` instead of baked-in DATA blocks, so an update = one SQL insert, no HTML paste. *(Good Claude Code task.)*
2. Deploy `top.html` + `/top` route. *(Claude Code task.)*
3. Considered reframing packs page around **median** (~$22, 56% under mint) instead of **mean** — decision pending.

## Update routine (PBC)
Send new tier sales files (epic / ultra_rare / rare / uncommon / legend) + usually a collection report CSV + remaining pack counts → parse new sales, add to DB, re-run engine → deliver updated `packs.html`, `value.html`, `pbc_snapshot_insert.sql`, refreshed backup JSON.

## GOTCHAS (PBC)
- **Comps-vs-manual-value gap:** value.html shows offer/sale comps next to assigned values. When a value is manually overridden well above visible comps, the page can look self-contradictory. Consider suppressing comps or labeling "manual valuation" on overridden cards.
- **Stale-engine risk:** if a session runs the *old* engine, the $50k/$60k overrides vanish. Now mitigated by keeping engine in repo — always use the repo version.
- **`re.sub` escape bug:** card data contains `\u` unicode escapes; use literal string splicing (find markers, slice) to swap DATA blocks, not regex replacement.
- **Report column naming:** engine handles both `CARD SET` (with space) and `CARDSET`.

## History / investigations
- **Pack-peeking exploit (June 2026):** investigated whether PBC packs are vulnerable to peeking exploits seen in other NFT products. Determined **inapplicable** — PBC runs on Hyperledger Sawtooth (permissioned private ledger). Only residual vector is a client/API-layer leak, which would be a TOS violation. Proposed empirical correlation test (pack SKUs vs. card SKUs pulled) to check for patterns.

---

# PROJECT 2 — Moonbirds ("Birbs Beyond") — NEW, 2026-07-31

Brand-new Panini NFT drop. **First-ever Panini Moonbirds product — no secondary market history exists.** Art/PFP NFT, not sports.

## Status: TRACKING ONLY (no engine yet)
Decision (2026-07-31): just track numbers for now. Do NOT force this through `pbc_engine.py` — different pools, tiers, and valuation logic entirely. A dedicated Moonbirds engine is a *later* build if the product warrants it.

## Set structure (from checklist `2026_Panini_NFT_Moonbirds_-_Birbs_Beyond.csv`)
- **25 characters** (Kenji, Ferno, Merlin, Enlightened Professor, etc.) — not athletes
- **133 cards total**
- Parallels & print runs:
  - Base: Black /1 · Holo Gold /10 · Purple /25 · Red /49 · Blue /99 · Silver /194 (20 cards each)
  - Kaboom inserts: Green /1 · Gold /10 · base /25 (4 cards each)
  - **Birbhalla /49** — the grail; single card (Enlightened Professor), 49 copies

## Pricing mechanism: OFFERS ONLY
No sales exist, so **outstanding offers are the sole signal** (this is the offer-based fallback tier of the soccer engine, run as the *primary* path). Offer boards are per-serial and can be deep (13–17 offers per card on the grail).

**Valuation principle (John, market expert):** *cards clear ABOVE offers* — offers are a floor/ceiling, real clearing is higher for scarce serials. John is comfortable pricing scarce serials above the visible offer book on a fresh drop. (Flagged the comps-gap risk; John accepted it.)

## Values set so far
| Card | Serial | Value | Basis |
|---|---|---|---|
| Birbhalla (Enlightened Professor) | 1/49 | $10,000 | observed best offer (17 offers); #1 collector premium (gold badge) |
| Birbhalla (Enlightened Professor) | 49/49 | $5,000 | manual — last-serial premium |
| Birbhalla (Enlightened Professor) | 2–48/49 | $1,000 | manual — observed offers were $200 (13 offers on #2,#3); marked up per "clears above offers" |

## Still needed for Moonbirds
- Offer data for the **other 132 cards** (all parallels × characters). Best: a marketplace **export** (JSON/CSV). Else: tier-by-tier best-offer ranges from the boards.
- **Mint price** of a pack (needed for predicted-multiple framing)
- **Pack recipe** — cards/pack + parallel/insert odds (needed to roll card values into pack EV). Without it: card-value table only, no pack EV.

---

# PROJECT 3 — MLB DFS

## Current focus: data-loading infrastructure rebuild (July 2026)
- Replacing a fragile full-season Savant crawler (`hitter-loader.js`) that had repeated GitHub Actions runner failures.
- **Replacement:** `edge_statcast_daily` table — one row per (player + game_date + p_throws + pitch_type), **raw counts/sums only, never averages** → enables exact rolling-window recomputation by summing rows.
- **Schema v2 patch:** added singles/doubles/triples/HR/HBP/la_sum/la_n/fb_bip/bip_typed → for outcome wOBA, average launch angle, fly-ball %.
- Chunked backfill script in progress.

## Standing to-dos (MLB)
- **Branch-and-bound pruning** optimization for the MLB optimizer — designed, Claude Code prompt drafted, **not yet built**. *(Claude Code task.)*

## History
- Origins (early 2026): first Burning Edges tool — baseball DFS matchup tool (weighted wOBA by pitch type + hot-streak scorer). Established the core stack (vanilla HTML/CSS/JS + Supabase + Netlify) and deployment workflow used by all later projects.

---

# PROJECT 4 — Golf DFS

## Tools
- **Cut-probability public page** — 50/50 side-by-side desktop layout (field graphic left, "Find My Lineup" calculator right); stacks vertically at 880px breakpoint.
- **Cut-survival tool** (June 2026, RBC Canadian Open) — pipeline ingesting DataGolf make-cut probabilities + DraftKings contest CSVs; computes per-lineup clean-sweep probabilities; builds field-wide Poisson-binomial survivor distribution graphic; updated with actual final-cut results.
- `golf_lookups` analytics table in Supabase (RLS enabled, fire-and-forget logging).

## Technical notes / gotchas (Golf)
- **U.S. Open upload bug fix:** browser-side dictionary encoding + gzip via `CompressionStream` reduced ~16MB payload to <1MB, staying within Netlify's 6MB function limit. Used magic-byte detection (`0x1f 0x8b`) instead of headers.
- **Parsing conventions:** DK lineup strings split on `" G "` after stripping leading `"G "`; CSVs use `utf-8-sig` encoding; DataGolf `"F. Last"` abbreviation format needs a programmatic `abbr()` helper + manual fix-dict for edge cases.

---

# Cross-project standing decisions
- **Documentation practice (2026-07-31):** maintain this master log as work happens, committed to the repo as canonical, to make chat handoffs clean. Pricing decisions from chat + backend changes from Claude Code both land here.
- **Engine-in-repo (2026-07-31):** `pbc_engine.py` now lives in the repo (via Claude Code), ending the loose-file re-upload workflow and its stale-copy risk.

---

## Changelog
- **2026-07-31** — Created master log. Started Moonbirds tracking (Birbhalla serial tiers set). Established doc-as-canonical practice. Noted engine-in-repo migration.
- **2026-07-09** — PBC pricing run: 11,950 base / 4,030 FOTL. Added Messi Gold base $50k + Mbappe Black/Nebula /1 $60k as persistent engine overrides. Applied +10% Messi/Mbappe/Yamal (output-only).
- **~2026-07-01** — Prior PBC baseline: 18,476 base / 5,365 FOTL; sales DB at 14,848; engine + data contract established.
