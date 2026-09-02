-- ============================================================
-- World Cup Floral Edition page: snapshot table with the same publish gate as
-- the other pack snapshot tables. Run this once in the Supabase SQL editor;
-- Claude then inserts/publishes via the service key. Until then, the /floral
-- page serves its baked FALLBACK_DATA (fully functional), and /api/floral-data
-- simply 404s -> page falls back.
-- ============================================================
create table if not exists floral_snapshots (
  id           bigint generated always as identity primary key,
  product      text,
  updated      text,
  pack_book_ev numeric,
  payload      jsonb not null,
  published    boolean not null default false,
  computed_at  timestamptz not null default now()
);
