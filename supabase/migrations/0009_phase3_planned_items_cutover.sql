-- ============================================================
-- 0009 · Phase 3: one source of truth for planned items
--
-- From Phase 3, Goals › Upcoming payments and Settings › Recurring read and
-- write planned_cashflows (the table the projection reads). The old tables
-- planned_outflows and recurring_transactions are KEPT, untouched, as an
-- archive; the app no longer writes to them.
--
-- This migration does one thing: a FINAL sync from the old tables into
-- planned_cashflows (same mapping as 0008 §7a/§7b), so edits made in the old
-- screens since 0008 ran aren't lost. It then records a marker in
-- app_settings. Re-running is safe and does nothing: the marker stops a second
-- sync from overwriting edits made in the new screens.
--
-- Additive only: no schema change, no deletes, nothing in the old tables changes.
--
-- Run BEFORE deploying the Phase 3 branch (ideally right before), so the new
-- screens start from your latest old-screen edits. If you deploy first the
-- app still works; edits made in the old screens after 0008 just won't appear
-- until you run this.
--
-- After this has run, do NOT re-run section 7 of 0008: it would overwrite
-- edits made in the new screens with the archived old values.
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE key = 'planned_items_cutover_at') THEN
    RAISE NOTICE '0009 already applied on %, nothing to do.', (SELECT value #>> '{}' FROM app_settings WHERE key = 'planned_items_cutover_at');
    RETURN;
  END IF;

  -- a. planned_outflows → one-off expenses (AUD). Wedding ones link to the wedding event.
  INSERT INTO planned_cashflows (description, kind, amount_cents, currency, frequency, start_date,
                                 category_id, account_id, status, event_id, source_table, source_id, notes)
  SELECT po.description, 'expense', -abs(po.amount_cents), 'AUD', 'once', po.due_date,
         (SELECT c.id FROM categories c WHERE lower(c.name) = lower(po.category) ORDER BY c.parent_id NULLS FIRST LIMIT 1),
         po.account_id, po.status,
         CASE WHEN po.category = 'Wedding' THEN (SELECT id FROM life_events WHERE kind = 'wedding' ORDER BY created_at LIMIT 1) END,
         'planned_outflows', po.id,
         concat_ws(' · ', nullif(po.notes, ''), CASE WHEN po.category IS NOT NULL THEN 'category: ' || po.category END)
  FROM planned_outflows po
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    description  = EXCLUDED.description,
    amount_cents = EXCLUDED.amount_cents,
    start_date   = EXCLUDED.start_date,
    account_id   = EXCLUDED.account_id,
    status       = EXCLUDED.status,
    notes        = EXCLUDED.notes;

  -- b. recurring_transactions → recurring cashflows (native currency kept).
  --    source_table = 'recurring_transactions' tells the projection they're
  --    already in recent spending ("Already in our spending" ticked).
  INSERT INTO planned_cashflows (description, kind, person_key, amount_cents, currency, frequency, start_date,
                                 category_id, account_id, status, source_table, source_id, notes)
  SELECT r.description,
         CASE WHEN r.amount_cents >= 0 THEN 'income' ELSE 'expense' END,
         CASE WHEN r.owner IN (SELECT key FROM people) THEN r.owner END,
         r.amount_cents, r.currency, r.recurrence, r.next_due,
         r.category_id, r.account_id,
         CASE WHEN r.is_active THEN 'planned' ELSE 'cancelled' END,
         'recurring_transactions', r.id, r.notes
  FROM recurring_transactions r
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    description  = EXCLUDED.description,
    amount_cents = EXCLUDED.amount_cents,
    currency     = EXCLUDED.currency,
    frequency    = EXCLUDED.frequency,
    start_date   = EXCLUDED.start_date,
    category_id  = EXCLUDED.category_id,
    account_id   = EXCLUDED.account_id,
    status       = EXCLUDED.status,
    notes        = EXCLUDED.notes;

  INSERT INTO app_settings (key, value) VALUES ('planned_items_cutover_at', to_jsonb(now()::text));
END $$;

COMMENT ON TABLE planned_outflows IS 'Archive since Phase 3 (0009): the app reads/writes planned_cashflows. Kept for history; not written.';
COMMENT ON TABLE recurring_transactions IS 'Archive since Phase 3 (0009): the app reads/writes planned_cashflows. Kept for history; not written.';

COMMIT;

-- ── Verify (paste separately) ───────────────────────────────────────────────
-- select key, value from app_settings where key = 'planned_items_cutover_at';     -- 1 row
-- select source_table, status, count(*) from planned_cashflows
--   where source_table in ('planned_outflows','recurring_transactions') group by 1, 2 order by 1, 2;
-- -- every old row has a copy (both should return 0):
-- select count(*) from planned_outflows po where not exists (select 1 from planned_cashflows p where p.source_table = 'planned_outflows' and p.source_id = po.id);
-- select count(*) from recurring_transactions r where not exists (select 1 from planned_cashflows p where p.source_table = 'recurring_transactions' and p.source_id = r.id);
