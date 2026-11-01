-- ============================================================
-- Migration 0008: Phase 1 backfill + base-case plan
-- Run in Supabase Dashboard → SQL Editor, AFTER 0007.
--
-- * Only INSERTs new rows or fills columns that 0007 added. Existing values
--   the owner has typed are never overwritten (every UPDATE is guarded).
-- * Idempotent: re-running it is safe. The planned_cashflows sync
--   (section 6) can be re-run any time to pick up edits made on the old
--   Goals/Settings screens; Phase 2 re-runs it once more before switching.
-- * All assumption values are ESTIMATES to be checked, not advice.
-- ============================================================

BEGIN;

-- ── 1. People (from the existing household allowlist / owner keys) ─────────
INSERT INTO people (key, display_name, user_id, has_private_hospital, has_hecs, sort_order)
SELECT v.key, v.display_name, hm.user_id, true, false, v.sort_order
FROM (VALUES ('evan', 'Evan', 1), ('rachel', 'Rachel', 2)) AS v(key, display_name, sort_order)
LEFT JOIN household_members hm ON lower(hm.display_name) = v.key
ON CONFLICT (key) DO NOTHING;

-- ── 2. Accounts: institution / profile / kind for the seeded accounts ──────
-- Matched by name AND only where still blank, so renamed accounts are left alone.
UPDATE accounts SET institution = 'CommBank', import_profile = 'commbank'
 WHERE institution IS NULL AND currency = 'AUD' AND type IN ('bank','savings','wedding')
   AND name IN ('Joint Bank','Wedding Account','Rachel Bank','Evan Bank');
UPDATE accounts SET institution = 'AIB', import_profile = 'generic'
 WHERE institution IS NULL AND name = 'Irish Bank';
UPDATE accounts SET institution = 'Vanguard' WHERE institution IS NULL AND name = 'Vanguard ETF';
UPDATE accounts SET institution = 'eToro'    WHERE institution IS NULL AND name = 'eToro';
-- kind is already 'asset' for every existing type (CHECK enforces it).

-- ── 3. Category kinds ──────────────────────────────────────────────────────
-- Only rows still on the default 'discretionary' are touched.
WITH RECURSIVE tree AS (
  SELECT id, name, name AS root FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.name, t.root FROM categories c JOIN tree t ON c.parent_id = t.id
)
UPDATE categories c SET kind = CASE
    WHEN t.root IN ('Housing/Utilities','Groceries','Insurance','Car') THEN 'essential'
    WHEN t.name IN ('Stocks') THEN 'savings'
    WHEN t.root ILIKE 'income%' OR t.name ILIKE 'salary%' THEN 'income'
    WHEN t.root ILIKE 'transfer%' OR t.name ILIKE 'transfer%' THEN 'transfer'
    ELSE c.kind
  END
FROM tree t
WHERE c.id = t.id AND c.kind = 'discretionary';

-- ── 4. Mark obvious historic transfers ─────────────────────────────────────
-- A pair = same AUD amount with opposite signs, two DIFFERENT accounts,
-- dates within 3 days, and at least one leg's description says "transfer".
-- Each row joins at most one pair (closest date first). Both legs point at
-- each other via transfer_peer_id. Unpaired rows that say "transfer" are
-- sent to the review queue instead of being guessed.
WITH cand AS (
  SELECT o.id AS out_id, i.id AS in_id, o.account_id AS out_acc, i.account_id AS in_acc,
         abs(o.date - i.date) AS gap
  FROM transactions o
  JOIN transactions i
    ON i.aud_amount_cents = -o.aud_amount_cents
   AND o.aud_amount_cents < 0
   AND i.account_id IS NOT NULL AND o.account_id IS NOT NULL
   AND i.account_id <> o.account_id
   AND abs(o.date - i.date) <= 3
  WHERE NOT o.is_transfer AND NOT i.is_transfer
    AND (o.description ~* '\m(transfer|tfr|xfer)\M' OR i.description ~* '\m(transfer|tfr|xfer)\M')
),
ranked AS (
  SELECT *,
    row_number() OVER (PARTITION BY out_id ORDER BY gap, in_id) AS r_out,
    row_number() OVER (PARTITION BY in_id  ORDER BY gap, out_id) AS r_in
  FROM cand
),
pairs AS (
  SELECT out_id, in_id, out_acc, in_acc FROM ranked WHERE r_out = 1 AND r_in = 1
),
upd_out AS (
  UPDATE transactions t SET is_transfer = true, transfer_peer_id = p.in_id, transfer_account_id = p.in_acc
  FROM pairs p WHERE t.id = p.out_id
  RETURNING t.id
)
UPDATE transactions t SET is_transfer = true, transfer_peer_id = p.out_id, transfer_account_id = p.out_acc
FROM pairs p WHERE t.id = p.in_id;

UPDATE transactions
   SET review_flags = array_append(review_flags, 'suspected_transfer')
 WHERE NOT is_transfer
   AND description ~* '\m(transfer|tfr|xfer)\M'
   AND NOT ('suspected_transfer' = ANY(review_flags));

-- ── 5. Baseline scenario + assumptions ─────────────────────────────────────
INSERT INTO scenarios (name, description, is_baseline, sort_order)
SELECT 'Baseline: ~$1M house, Mar 2028',
       'Owner base case (1 Nov 2026): buy a ~$1M home in Perth in 2028 with a $250k deposit.',
       true, 0
WHERE NOT EXISTS (SELECT 1 FROM scenarios WHERE is_baseline);

-- Percent values (3 = 3 % p.a.). Estimates only. Edit on the Assumptions screen (Phase 2).
INSERT INTO assumptions (scenario_id, key, value, notes)
SELECT s.id, v.key, v.value, v.notes
FROM scenarios s
CROSS JOIN (VALUES
  ('inflation_pct',            3.0,  'CPI, long-run estimate'),
  ('wage_growth_pct',          3.5,  'Salary growth p.a.'),
  ('cash_return_pct',          4.5,  'High-interest savings rate'),
  ('investment_return_pct',    7.0,  'ETF total return, before tax'),
  ('super_return_pct',         7.0,  'Super return after fees'),
  ('mortgage_rate_pct',        6.0,  'Variable owner-occupier rate'),
  ('house_price_growth_pct',   4.0,  'Perth dwelling price growth'),
  ('super_guarantee_pct',     12.0,  'Employer SG rate (verify each FY)'),
  ('fx_eur_aud',               1.65, 'Fallback AUD per EUR when no live rate')
) AS v(key, value, notes)
WHERE s.is_baseline
ON CONFLICT (scenario_id, key) DO NOTHING;

-- ── 6. Life events ─────────────────────────────────────────────────────────
-- 6a. House purchase (shared plan, so every scenario starts from it)
INSERT INTO life_events (name, kind, event_date, currency, budget_cents, params, notes, sort_order)
SELECT 'Buy our first home (Perth)', 'house_purchase', DATE '2028-03-01', 'AUD', 25000000,
       jsonb_build_object(
         'price_cents',        100000000,
         'deposit_cents',      25000000,
         'state',              'WA',
         'first_home_buyer',   true,
         'new_build',          false,
         'loan_term_months',   360
       ),
       'Base case from the owner: ~$1M by 2028, $250k deposit (covers deposit + duty + costs). Date is editable.',
       1
WHERE NOT EXISTS (SELECT 1 FROM life_events WHERE kind = 'house_purchase' AND scenario_id IS NULL);

-- 6b. The wedding, as a generic event (status 'done' once every item is paid)
INSERT INTO life_events (name, kind, event_date, status, currency, budget_cents, params, notes, sort_order)
SELECT 'Our Wedding 2026', 'wedding',
       COALESCE((SELECT max(due_date) FROM planned_outflows WHERE category = 'Wedding'), DATE '2026-12-01'),
       CASE WHEN EXISTS (SELECT 1 FROM wedding_items)
             AND NOT EXISTS (SELECT 1 FROM wedding_items WHERE status NOT IN ('paid','cancelled')) THEN 'done'
            ELSE 'planned' END,
       'AUD',
       COALESCE((SELECT (value #>> '{}')::bigint FROM app_settings WHERE key = 'wedding_budget_cents'), 7500000),
       jsonb_build_object('source', 'wedding_items'),
       'Created from the Wedding tab. Archive once the last invoice is paid.',
       0
WHERE NOT EXISTS (SELECT 1 FROM life_events WHERE kind = 'wedding');

UPDATE wedding_items SET event_id = (SELECT id FROM life_events WHERE kind = 'wedding' ORDER BY created_at LIMIT 1)
 WHERE event_id IS NULL;

-- ── 7. Planned cashflows (re-runnable sync from the old tables) ────────────
-- 7a. planned_outflows → one-off expenses (AUD). Wedding ones link to the event.
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

-- 7b. recurring_transactions → recurring cashflows (native currency kept)
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

-- 7c. Wedding balances still owed in EUR → EUR cashflows on the wedding event
--     (this is the generic "event with a EUR budget" that replaces the tab).
INSERT INTO planned_cashflows (description, kind, amount_cents, currency, frequency, start_date,
                               account_id, status, event_id, source_table, source_id, notes)
SELECT 'Wedding: ' || w.item || ' (balance)', 'expense', -abs(w.balance_owed_eur_cents), 'EUR', 'once',
       (SELECT event_date FROM life_events WHERE kind = 'wedding' ORDER BY created_at LIMIT 1),
       w.account_id,
       CASE WHEN w.status = 'cancelled' THEN 'cancelled' ELSE 'planned' END,
       w.event_id, 'wedding_items', w.id, w.notes
FROM wedding_items w
WHERE COALESCE(w.balance_owed_eur_cents, 0) > 0
ON CONFLICT (source_table, source_id) DO UPDATE SET
  description  = EXCLUDED.description,
  amount_cents = EXCLUDED.amount_cents,
  status       = EXCLUDED.status,
  notes        = EXCLUDED.notes;

COMMIT;
