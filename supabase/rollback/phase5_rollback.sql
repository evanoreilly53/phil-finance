-- ============================================================
-- ROLLBACK for Phase 5 (no migration: there is no 0011)
-- Only needed if you go back to the Phase 4 app code (main @ 8e17d69).
-- Redeploy the old code FIRST.
--
-- Phase 5 changed no tables. Everything it saves lives in rows that already
-- existed in Phase 4:
--   * assumptions rows with new keys: fhss_use, investment_volatility_pct,
--     super_volatility_pct, salary_sacrifice__<person>, birth_month__<person>.
--     The Phase 4 app ignores keys it doesn't know, so they are harmless.
--     Step 1 removes them (optional tidying).
--   * life_events.status = 'done' on the house purchase, set by
--     "We've bought it" (Home Loan mode). The Phase 4 projection does NOT buy
--     a house whose status is 'done', so the house, the mortgage and the
--     deposit draw-down would vanish from Future. Step 2 puts it back to
--     'planned'. SKIP step 2 if you really have bought and want the old app
--     to stop modelling the purchase.
--
-- Nothing else is touched: planned items, salaries, contributions entered on
-- Track › Income, accounts and snapshots all stay as they are.
-- ============================================================

BEGIN;

-- 1. Phase 5 assumption keys (optional: the Phase 4 app ignores them)
DELETE FROM assumptions
 WHERE key IN ('fhss_use', 'investment_volatility_pct', 'super_volatility_pct')
    OR key LIKE 'salary\_sacrifice\_\_%' ESCAPE '\'
    OR key LIKE 'birth\_month\_\_%' ESCAPE '\';

-- 2. House purchase back to planned (see the note above before running)
UPDATE life_events SET status = 'planned'
 WHERE kind = 'house_purchase' AND status = 'done' AND scenario_id IS NULL;

COMMIT;

-- Check:
--   SELECT key, value FROM assumptions WHERE key LIKE '%\_\_%' ESCAPE '\';   -- expect no rows
--   SELECT name, status FROM life_events WHERE kind = 'house_purchase';      -- expect planned
