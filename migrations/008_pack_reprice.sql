-- ============================================================
-- Always-on sales-driven repricing. Moves the per-card value map and the sales
-- history out of static JSON files and into the DB, so a scheduled function can
-- reprice off live blockchain sales (chain_events) on the recency rules.
--
-- pack_values  = the current per-card value map (what the snapshot recompute reads)
-- pack_sales   = the running sales log (historical seed + appended chain_events)
--
-- Both are product-scoped so NFL Prizm, Silhouette, etc. share the engine.
-- Run once in the Supabase SQL editor.
-- ============================================================

create table if not exists pack_values (
  product     text not null,
  sku_base    text not null,
  value       numeric not null,
  cardset     text,
  athlete     text,
  run         integer,
  slot        text,             -- base | rookiebase | parallel | insert
  src         text,             -- market | owner | model | hold
  updated_at  timestamptz not null default now(),
  primary key (product, sku_base)
);
create index if not exists pack_values_product_idx on pack_values (product);

create table if not exists pack_sales (
  id          bigint generated always as identity primary key,
  product     text not null,
  sku_base    text,
  athlete     text,
  parallel    text,
  serial      integer,
  run         integer,
  price       numeric not null,
  tags        text,             -- comma-joined ("perfect mint", "jersey mint", ...)
  sold_at     date,
  source      text not null default 'chain',   -- seed | chain
  dedup       text unique       -- product|sku_base|serial|price|sold_at  (idempotent appends)
);
create index if not exists pack_sales_reprice_idx on pack_sales (product, athlete, parallel, sold_at desc);
