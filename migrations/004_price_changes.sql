-- ============================================================
-- Public price-change feed (the /changes page). The hourly pipeline inserts a
-- row whenever it makes a MAJOR adjustment (pack EV moves >= $2, or a parallel's
-- value moves >= 15%). Routine drift is not logged. Run once in the SQL editor.
-- ============================================================
create table if not exists price_changes (
  id          bigint generated always as identity primary key,
  product     text not null default 'moonbirds',
  scope       text,             -- what moved (e.g. "Kaboom Gold", "Pack book value")
  headline    text not null,    -- short human line
  detail      text,             -- "$1,971 -> $3,546"
  old_value   numeric,
  new_value   numeric,
  created_at  timestamptz not null default now()
);
create index if not exists price_changes_created_idx on price_changes (created_at desc);
