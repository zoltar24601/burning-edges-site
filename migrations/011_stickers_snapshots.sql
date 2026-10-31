-- ============================================================
-- 2026 WC Stickers page: hourly live pricing. Run this once in the Supabase SQL
-- editor. netlify/functions/stickers-refresh.mjs then keeps ONE row up to date
-- every hour; /api/stickers-data serves its payload. Until this exists the
-- refresh just errors and the /stickers page shows its baked numbers.
-- ============================================================
create table if not exists stickers_snapshots (
  id           bigint generated always as identity primary key,
  product      text,
  updated      text,             -- display time of the last reprice
  pack_book_ev numeric,          -- denormalized for quick listing
  payload      jsonb not null,   -- the page data (tools/stickers-model.mjs output)
  sales        jsonb,            -- rolling sales log the model reads (pruned each run)
  last_ts      timestamptz,      -- newest chain sale already merged
  published    boolean not null default false,
  computed_at  timestamptz not null default now()
);
