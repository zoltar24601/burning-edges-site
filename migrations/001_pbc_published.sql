-- ============================================================
-- Step 5 wire-up: publish gate for pbc_snapshots
-- ============================================================
-- Run this in Supabase (SQL editor) BEFORE merging the /api/pbc-data
-- `published=eq.true` filter to main. If the column does not exist when the
-- filtered function goes live, the PostgREST query errors, the function
-- returns non-200, and packs.html / value.html fall back to their baked
-- snapshot (visible but stale). So: run this migration first, then merge.
--
-- Workflow this enables: engine writes a snapshot -> you INSPECT it ->
-- you flip `published = true` for that row. Nothing is live until you do.

-- 1. Add the gate column (idempotent; non-destructive; default hidden).
alter table pbc_snapshots
  add column if not exists published boolean not null default false;

-- 2. Preserve current live behavior: publish the most recent existing
--    snapshot (the one currently served) so the page shows identical data
--    the moment the filter goes live.
update pbc_snapshots
  set published = true
  where computed_at = (select max(computed_at) from pbc_snapshots);

-- To publish a future snapshot after inspecting it:
--   update pbc_snapshots set published = true where id = <snapshot_id>;
-- To unpublish (roll back to the previous published row):
--   update pbc_snapshots set published = false where id = <snapshot_id>;
