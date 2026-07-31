# PBC Data Contract

The exact shape of the data that flows **`pbc_engine.py` → `pbc_snapshots` (Supabase) → `/api/pbc-data` → packs.html / value.html**. After the Step 5 wire-up there is no human in this path, so both pages **shape-check** the fetched payload against this contract before using it and fall back to a baked snapshot if it fails. If you rename or drop a field in the engine, update this file, the page shape-checks, and the baked fallbacks together.

Producer: `pbc_engine.py` (writes `calc_data.json`, `valuer_data_v2.json`, `pbc_snapshot_insert.sql`).
Server: `netlify/functions/pbc-data.js` — serves the newest **published** `pbc_snapshots` row (`?type=calc` → `payload`, `?type=valuer` → `valuer`), 5-min CDN cache.

---

## `payload` (calc)  — consumed by `packs.html` as `DATA`

Top-level keys (all required; `packs.html` `validCalc()` checks every one):

| key | type | notes |
|---|---|---|
| `updated` | string | ISO date, `date.today()` at engine run |
| `release` | string | "2026 Panini NFT Prizm World Cup Soccer" |
| `mint` | int | base mint price (25) |
| `fotlMint` | int | FOTL mint price (150) |
| `multiplier` | number | predicted = book × this (2.5) |
| `basePacks` | int | typed in at run time (not derived) |
| `fotlPacks` | int | typed in at run time |
| `insertOdds` | int | insert-slot % (35) |
| `poolCopiesTotal` | object | `{silver,nonsilver,insert,fotl}` → int (raw UNCLAIMED) |
| `top` | array | top 120 cards by `p×u` (see below), **non-empty** |
| `tail` | object | keyed by pool → `{copies:int, value:number}` |

`top[]` card object: `{ a:string(athlete), s:string(cardset), r:int(mint run), u:int(unclaimed copies), p:number(per-copy value), pool:"silver"|"nonsilver"|"insert"|"fotl" }`

## `valuer`  — consumed by `value.html` as `{CARDS, COMPS}`

Top-level keys (`value.html` `validValuer()` checks `cards` is a non-empty array and `comps` exists):

- `cards`: array of `{ a:string, s:string, r:int, v:number(value), t:"M"|"E"|"S"(tier), m:string(method code), d:object(method detail) }`
- `comps`: array of `{ a:string, s:string, r:int, n:number(serial#), p:number(price), x:0|1(1=premium serial) }`, deduped by (a,s,r,serial) keeping highest price, only `p >= 50`.

Method codes (`m`): `ladder`, `serial`, `manual`, `sale`, `offer`, `premest`, `goldfloor`, `floor`, `floor1`, `common_unc`, `mega_unc`.

---

## `pbc_snapshots` table

`id` bigint · `release` text · `base_packs` int · `fotl_packs` int · `base_book` numeric · `fotl_book` numeric · `base_mint` int · `fotl_mint` int · `multiplier` numeric · `payload` jsonb · `valuer` jsonb · `computed_at` timestamptz · **`published` boolean** (added by `migrations/001_pbc_published.sql`).

## Publish workflow (the review gate)

1. Run the engine → get `pbc_snapshot_insert.sql` → insert the row (`published` defaults **false**, so it is NOT live).
2. **Inspect** the inserted snapshot.
3. `update pbc_snapshots set published = true where id = <id>;` — now it's live (within the 5-min cache).
4. Roll back by flipping the previous row back to `published = true` (or the new one to false).

`/api/pbc-data` filters `published=eq.true`, so an un-reviewed insert never reaches the pages. **Run the migration before merging the filter**, or the query errors and the pages serve the baked fallback.

## Baked fallback (disaster floor)

Each page embeds a last-known snapshot as `FALLBACK_DATA`, used **only** when the fetch or shape-check fails — a stale-but-working page instead of a blank/errored one. It is not the update mechanism; refresh it occasionally by pasting a known-good payload, but normal updates are just a published SQL insert.
