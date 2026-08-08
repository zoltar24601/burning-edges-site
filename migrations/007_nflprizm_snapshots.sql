-- ============================================================
-- 2021 NFL Prizm page: snapshot table with the same publish gate as
-- silhouette_snapshots / moonbirds_snapshots. Run this once in the Supabase SQL
-- editor before the /api/nflprizm-data function can serve data. Claude then
-- inserts/publishes via the service key.
-- ============================================================
create table if not exists nflprizm_snapshots (
  id           bigint generated always as identity primary key,
  product      text,
  updated      text,             -- the payload's "updated" date (display)
  pack_book_ev numeric,          -- denormalized for quick listing
  payload      jsonb not null,   -- the full pack payload
  published    boolean not null default false,   -- publish gate (invisible until true)
  computed_at  timestamptz not null default now()
);

-- (no seed row here -- Claude inserts the first snapshot as published=false,
--  you inspect it, then it gets flipped to published=true.)
