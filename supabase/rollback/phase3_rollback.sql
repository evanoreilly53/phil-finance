-- ============================================================
-- ROLLBACK for Phase 3 (migration 0009 + data created by the Phase 3 screens)
-- Only needed if you go back to the Phase 2 app code (main @ a30c6b6).
-- Redeploy the old code FIRST.
--
-- 0009 only copied the old tables into planned_cashflows and added a marker,
-- and the old tables were never changed, so the Phase 2 app works on the
-- database as it is. This script just tidies up so the Phase 2 projection
-- matches what the Phase 2 screens show.
--
-- What it does:
--   1. Removes the 0009 marker and table comments.
--   2. Recurring items added in the Phase 3 Settings screen with "Already in
--      our spending" ticked (source_table = 'settings_recurring') are marked
--      cancelled: the Phase 2 projection doesn't know that flag and would count
--      them twice. Re-enter any you still want in the old Settings › Recurring.
--   3. Leaves scenarios, scenario house plans and leave events alone: the
--      Phase 2 app only reads the baseline and shared events, so they're
--      simply ignored. (To hide them: update scenarios set is_archived = true
--      where not is_baseline;)
--
-- What you keep: everything else. Nothing is deleted.
-- Payments added/edited in the Phase 3 Goals screen stay in planned_cashflows
-- (the Phase 2 projection reads them); the old Goals screen won't list them.
-- ============================================================

BEGIN;

DELETE FROM app_settings WHERE key = 'planned_items_cutover_at';
COMMENT ON TABLE planned_outflows IS NULL;
COMMENT ON TABLE recurring_transactions IS NULL;

UPDATE planned_cashflows SET status = 'cancelled'
 WHERE source_table = 'settings_recurring' AND status = 'planned';

COMMIT;

-- Check:
-- select count(*) from planned_cashflows where source_table = 'settings_recurring' and status = 'planned';  -- 0
