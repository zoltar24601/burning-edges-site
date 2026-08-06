-- ============================================================
-- Panini Blockchain (Sawtooth) ingest. The block poller decodes each
-- panini-cx-crypto transaction and upserts one row per transaction here.
-- `sku_base` joins to the PSKU in the Panini collection reports -> card name /
-- parallel / run, which is how a raw sale becomes "Ronaldo Black /1 sold $X".
-- Run once in the Supabase SQL editor.
-- ============================================================
create table if not exists chain_events (
  tx_id       text primary key,
  block_num   bigint,
  action      text,               -- transfer_product, mint, etc.
  price       numeric,
  sku_base    text,               -- e.g. packcard-1940_377840_9774508_1
  serial      int,                -- e.g. 42
  run         int,                -- e.g. 49
  from_key    text,
  to_key      text,
  ts          timestamptz,        -- on-chain timestamp
  is_sale     boolean,            -- priced peer-to-peer transfer (price > 0)
  raw         jsonb,
  ingested_at timestamptz not null default now()
);
create index if not exists chain_events_sku_idx  on chain_events (sku_base);
create index if not exists chain_events_ts_idx   on chain_events (ts desc);
create index if not exists chain_events_sale_idx on chain_events (is_sale) where is_sale;

-- Poller cursor: the highest block already ingested, so each run only pulls new
-- blocks and never double-counts.
create table if not exists chain_sync (
  id             int primary key default 1,
  last_block_num bigint not null default 0,
  updated_at     timestamptz not null default now()
);
insert into chain_sync (id, last_block_num) values (1, 0) on conflict (id) do nothing;
