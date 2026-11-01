-- ============================================================
-- ROLLBACK for migrations 0007 + 0008 (Phase 1)
-- Only run this if you need to undo Phase 1 in the database.
-- Deploy the pre-Phase-1 app code (main @ c99aa39) FIRST: the Phase 1 code
-- needs these tables and columns.
--
-- What you lose: budgets, scenarios/assumptions, life events, planned
-- cashflows, people, import history (import_batches), transfer links, review
-- flags and import fingerprints, account details added in Phase 1 (rates,
-- loans, institution, hints) and category kinds.
-- What you keep: every transaction (including ones imported in Phase 1),
-- every balance snapshot, accounts, categories, goals, wedding items, the
-- old planned_outflows / recurring_transactions tables, the audit log.
--
-- It refuses to run if any account uses a Phase 1 account type (credit card,
-- mortgage, ...): change or deactivate those accounts' types first.
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE type NOT IN ('bank','investment','super','savings','wedding')) THEN
    RAISE EXCEPTION 'Some accounts use Phase 1 types (%). Change them to bank/investment/super/savings/wedding first.',
      (SELECT string_agg(DISTINCT type, ', ') FROM accounts WHERE type NOT IN ('bank','investment','super','savings','wedding'));
  END IF;
END $$;

DROP VIEW IF EXISTS account_freshness;

ALTER TABLE wedding_items DROP COLUMN IF EXISTS event_id;
DROP TABLE IF EXISTS planned_cashflows;
DROP TABLE IF EXISTS life_events;
DROP TABLE IF EXISTS assumptions;
DROP TABLE IF EXISTS scenarios;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS people;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_external_id_key;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_review_flags_check;
DROP INDEX IF EXISTS transactions_account_date_idx;
DROP INDEX IF EXISTS transactions_needs_review_idx;
DROP INDEX IF EXISTS transactions_import_batch_idx;
ALTER TABLE transactions
  DROP COLUMN IF EXISTS needs_review,
  DROP COLUMN IF EXISTS review_flags,
  DROP COLUMN IF EXISTS duplicate_of_id,
  DROP COLUMN IF EXISTS transfer_peer_id,
  DROP COLUMN IF EXISTS transfer_account_id,
  DROP COLUMN IF EXISTS is_transfer,
  DROP COLUMN IF EXISTS balance_after_cents,
  DROP COLUMN IF EXISTS import_batch_id,
  DROP COLUMN IF EXISTS external_id;
DROP TABLE IF EXISTS import_batches;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_kind_matches_type;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_kind_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_import_profile_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_number_hint_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_offset_not_self;
ALTER TABLE accounts
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS institution,
  DROP COLUMN IF EXISTS account_number_hint,
  DROP COLUMN IF EXISTS import_profile,
  DROP COLUMN IF EXISTS interest_rate_pct,
  DROP COLUMN IF EXISTS expected_return_pct,
  DROP COLUMN IF EXISTS annual_fee_cents,
  DROP COLUMN IF EXISTS fee_pct,
  DROP COLUMN IF EXISTS loan_original_cents,
  DROP COLUMN IF EXISTS loan_start_date,
  DROP COLUMN IF EXISTS loan_term_months,
  DROP COLUMN IF EXISTS loan_repayment_cents,
  DROP COLUMN IF EXISTS loan_repayment_freq,
  DROP COLUMN IF EXISTS loan_interest_only,
  DROP COLUMN IF EXISTS offset_account_id,
  DROP COLUMN IF EXISTS super_fund,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS notes;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check CHECK (type IN ('bank','investment','super','savings','wedding'));

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE categories DROP COLUMN IF EXISTS kind;

ALTER TABLE fx_rates DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS fetched_at;

DROP TRIGGER IF EXISTS audit_categories ON categories;
DROP TRIGGER IF EXISTS audit_fx_rates ON fx_rates;

COMMIT;
