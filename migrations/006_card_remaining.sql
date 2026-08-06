-- ============================================================
-- Pull tracker: "what's still sealed in packs", derived from the chain.
-- card_remaining is SEEDED ONCE from a collection report (the last manual CSV),
-- then the poller decrements it on every pack pull it sees on-chain. chain_pulls
-- records each individual serial as it's opened (for serial-level Hits Remaining).
-- Run once in the Supabase SQL editor.
-- ============================================================
create table if not exists card_remaining (
  sku_base    text primary key,     -- packcard-<...> base (matches chain sku_base + report PSKU)
  product     text,                 -- moonbirds / silhouette / soccer
  athlete     text,
  cardset     text,
  run         int,
  remaining   int not null,         -- sealed copies left; seeded from report UNCLAIMED, decremented per pull
  seeded_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists card_remaining_product_idx on card_remaining (product);

create table if not exists chain_pulls (
  id          bigserial primary key,
  tx_id       text unique,          -- the on-chain pull transaction (dedup)
  sku_base    text,
  serial      int,
  run         int,
  to_key      text,                 -- the collector who pulled it
  block_num   bigint,
  ts          timestamptz,
  ingested_at timestamptz not null default now()
);
create index if not exists chain_pulls_sku_idx on chain_pulls (sku_base);
create index if not exists chain_pulls_serial_idx on chain_pulls (sku_base, serial);

-- atomic decrement the poller calls once per newly-seen pull
create or replace function decrement_remaining(p_sku text, p_n int) returns void language sql as $$
  update card_remaining set remaining = greatest(0, remaining - p_n), updated_at = now()
  where sku_base = p_sku;
$$;
