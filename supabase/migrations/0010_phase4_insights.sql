-- ============================================================
-- 0010 · Phase 4: check-in state (insights + subscriptions) and the monthly
--        check-in log
--
-- Adds two small tables. Additive only: no existing table or row changes.
-- Idempotent: IF NOT EXISTS everywhere; policies and triggers are dropped and
-- re-created. Runs in one transaction.
--
--   insight_states  What you did with a check-in card or a detected
--                   subscription, per household (not per browser):
--                     done         hidden for the month it was done in
--                     snoozed      hidden until snooze_until
--                     intentional  "That's intentional": that key never shows again
--                     tracked      a detected subscription you added as a
--                                  planned item (ref_id = planned_cashflows.id)
--                     dismissed    a detected "subscription" that isn't one
--   checkin_log     One row per month: the projected house-deposit month the
--                   first time the check-in was opened that month. The
--                   "goal drift" insight compares this month with last month.
--
-- Safe to run before deploying: today's app doesn't read these tables.
-- If the Phase 4 code is deployed BEFORE this runs, nothing breaks: cards
-- show without Done / Snooze / Intentional being remembered (the buttons say
-- the migration is missing), and goal drift only reports "behind target".
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS insight_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 300),
  scope         text NOT NULL DEFAULT 'insight' CHECK (scope IN ('insight','subscription')),
  state         text NOT NULL CHECK (state IN ('done','snoozed','intentional','tracked','dismissed')),
  done_month    text CHECK (done_month IS NULL OR done_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  snooze_until  date,
  ref_id        uuid,              -- planned_cashflows.id for a tracked subscription (no FK: the item can be deleted in Settings)
  note          text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  CHECK (state <> 'snoozed' OR snooze_until IS NOT NULL),
  CHECK (state <> 'done' OR done_month IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS checkin_log (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month                      text NOT NULL UNIQUE CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  deposit_event_id           uuid,          -- life_events.id of the house (no FK: scenarios come and go)
  deposit_projected_month    text,          -- 'now', 'YYYY-MM', or NULL (not reached in the projection)
  deposit_target_month       text,
  deposit_target_cents       bigint,
  net_worth_cents            bigint,
  created_by                 uuid REFERENCES auth.users(id),
  created_at                 timestamptz DEFAULT now()
);

ALTER TABLE insight_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_log    ENABLE ROW LEVEL SECURITY;

-- Same shape as 0007: members read/update/delete; inserts stamped with the creator.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['insight_states','checkin_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Household members can read" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can insert own" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can update" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can delete" ON %I', t);
    EXECUTE format('CREATE POLICY "Household members can read" ON %I FOR SELECT USING (is_household_member(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Household members can insert own" ON %I FOR INSERT WITH CHECK (is_household_member(auth.uid()) AND created_by = auth.uid())', t);
    EXECUTE format('CREATE POLICY "Household members can update" ON %I FOR UPDATE USING (is_household_member(auth.uid())) WITH CHECK (is_household_member(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Household members can delete" ON %I FOR DELETE USING (is_household_member(auth.uid()))', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()', 'audit_' || t, t);
  END LOOP;
END $$;

COMMIT;

-- ── Verify (paste separately after running) ─────────────────────────────────
-- select tablename, rowsecurity from pg_tables where tablename in ('insight_states','checkin_log');   -- 2 rows, rowsecurity = true
-- select tablename, policyname from pg_policies where tablename in ('insight_states','checkin_log') order by 1, 2;  -- 4 policies each
-- select count(*) from insight_states;   -- 0 until you press Done / Snooze / Intentional
-- select * from checkin_log;             -- one row appears the first time Home or the check-in opens each month
