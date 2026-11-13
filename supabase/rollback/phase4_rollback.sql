-- ============================================================
-- ROLLBACK for Phase 4 (migration 0010)
-- Only needed if you go back to the Phase 3 app code (main @ 757e770).
-- Redeploy the old code FIRST; the Phase 3 app never reads these tables, so
-- running this is optional tidying.
--
-- What it removes: the two Phase 4 tables (your Done / Snooze / Intentional
-- choices, tracked/dismissed subscription marks, and the monthly check-in log).
--
-- What it keeps:
--   * Planned items created by "Track as planned item" (planned_cashflows rows
--     with source_table = 'detected_subscription'). The Phase 3 app shows them
--     in Settings › Recurring and does NOT know they are already in your
--     spending, so the projection would count them twice. Step 2 cancels them.
--   * Voluntary concessional contributions entered on Track › Income
--     (source_table = 'super_concessional'): Phase 3 treats them as ordinary
--     planned super contributions, which is what they are. Kept.
--   * The wedding archive flag (life_events.is_archived on the wedding event).
--     Phase 3 hides archived events from Future; step 3 un-archives it so the
--     wedding pin comes back.
-- ============================================================

BEGIN;

-- 1. Phase 4 tables
DROP TABLE IF EXISTS insight_states;
DROP TABLE IF EXISTS checkin_log;

-- 2. Tracked subscriptions would be double-counted by the Phase 3 projection
UPDATE planned_cashflows SET status = 'cancelled'
 WHERE source_table = 'detected_subscription' AND status = 'planned';

-- 3. Wedding back on the Phase 3 timeline
UPDATE life_events SET is_archived = false WHERE kind = 'wedding' AND is_archived;

COMMIT;
