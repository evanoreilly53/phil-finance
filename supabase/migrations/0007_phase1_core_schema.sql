-- ============================================================
-- Migration 0007: Phase 1 core schema (additive only)
-- Run in Supabase Dashboard → SQL Editor, BEFORE 0008.
--
-- * Adds columns and tables; never drops or rewrites owner data.
-- * Idempotent: safe to run more than once (IF NOT EXISTS / DROP ... IF EXISTS
--   before re-creating policies, triggers and constraints).
-- * Runs in a single transaction: if any statement fails nothing is applied.
--
-- Conventions kept from 0002/0003/0005:
--   money = bigint cents (signed; negative = expense / amount owed)
--   RLS   = is_household_member(auth.uid()); INSERT on user-written tables
--           also requires created_by = auth.uid()
--   audit = audit_trigger_fn() on every mutable table
--   rates = numeric percent (6.25 = 6.25 % p.a.)
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. People (the two of you, as data rather than CHECK lists)
--    key matches the existing owner keys so later tables can FK to it.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS people (
  key                      text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$' AND key NOT IN ('joint','any')),
  display_name             text NOT NULL,
  user_id                  uuid REFERENCES auth.users(id),
  birth_year               int CHECK (birth_year BETWEEN 1900 AND 2100),
  has_private_hospital     boolean NOT NULL DEFAULT true,   -- false → Medicare Levy Surcharge may apply (Phase 2)
  has_hecs                 boolean NOT NULL DEFAULT false,  -- HECS supported by the engine, off by default
  sort_order               int NOT NULL DEFAULT 0,
  created_at               timestamptz DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. Accounts: liabilities, institutions, rates, loans, offset, import profile
--    Liability balances are stored NEGATIVE (amount owed), so net worth is a
--    plain sum, the same convention a CommBank credit-card export uses.
-- ────────────────────────────────────────────────────────────
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check CHECK (type IN (
  -- assets (existing)
  'bank','investment','super','savings','wedding',
  -- assets (new)
  'offset','cash','property','other_asset',
  -- liabilities (new)
  'credit_card','mortgage','loan','other_liability'
));

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'asset';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_kind_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN ('asset','liability'));
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_kind_matches_type;
ALTER TABLE accounts ADD CONSTRAINT accounts_kind_matches_type CHECK (
  (kind = 'liability') = (type IN ('credit_card','mortgage','loan','other_liability'))
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS institution          text;           -- 'CommBank', 'AIB', 'Vanguard', ...
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_number_hint  text;           -- last 4 digits, used to spot "Transfer to xx1234"
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS import_profile       text;           -- CSV profile to pre-select on Import
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_import_profile_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_import_profile_check CHECK (import_profile IS NULL OR import_profile IN ('commbank','generic'));
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_number_hint_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_number_hint_check CHECK (account_number_hint IS NULL OR account_number_hint ~ '^[0-9]{3,6}$');

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS interest_rate_pct     numeric(6,3);  -- savings rate, or loan/card rate
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS expected_return_pct   numeric(6,3);  -- investments/super; NULL → scenario assumption
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS annual_fee_cents      bigint;        -- fixed fees (super admin fee, card fee)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fee_pct               numeric(6,3);  -- % of balance fees (super/ETF MER)
-- Loans / mortgage
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_original_cents   bigint CHECK (loan_original_cents IS NULL OR loan_original_cents > 0);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_start_date       date;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_term_months      int CHECK (loan_term_months IS NULL OR loan_term_months BETWEEN 1 AND 600);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_repayment_cents  bigint CHECK (loan_repayment_cents IS NULL OR loan_repayment_cents > 0);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_repayment_freq   text CHECK (loan_repayment_freq IS NULL OR loan_repayment_freq IN ('weekly','fortnightly','monthly'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS loan_interest_only    boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS offset_account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL;  -- on the LOAN row: which account offsets it
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_offset_not_self;
ALTER TABLE accounts ADD CONSTRAINT accounts_offset_not_self CHECK (offset_account_id IS NULL OR offset_account_id <> id);
-- Super
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS super_fund            text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sort_order            int NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes                 text;

-- ────────────────────────────────────────────────────────────
-- 3. Categories: a type flag for spending/insights/budgets
-- ────────────────────────────────────────────────────────────
ALTER TABLE categories ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'discretionary';
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check CHECK (kind IN ('income','essential','discretionary','savings','transfer'));

-- ────────────────────────────────────────────────────────────
-- 4. Import batches (one per uploaded file) → freshness + undo
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_batches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid REFERENCES accounts(id) ON DELETE SET NULL,  -- NULL = multi-account generic file
  profile                text NOT NULL CHECK (profile IN ('commbank','generic')),
  file_name              text,
  row_count              int NOT NULL DEFAULT 0,   -- rows in the file
  imported_count         int NOT NULL DEFAULT 0,
  duplicate_count        int NOT NULL DEFAULT 0,   -- skipped as exact duplicates
  flagged_count          int NOT NULL DEFAULT 0,   -- imported but sent to the review queue
  date_from              date,
  date_to                date,                     -- "data fresh to" for this account
  closing_balance_cents  bigint,                   -- from the bank's running balance, if the file had one
  created_by             uuid REFERENCES auth.users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_batches_account_idx ON import_batches(account_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 5. Transactions: dedupe fingerprint, transfers, review queue
-- ────────────────────────────────────────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_id         text;    -- stable import fingerprint (or bank id)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id     uuid REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS balance_after_cents bigint;  -- bank running balance after this row, if provided
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer         boolean NOT NULL DEFAULT false;  -- excluded from spending/income
-- transfer_account_id deliberately has NO foreign key: a second FK from
-- transactions to accounts would make PostgREST's `accounts(...)` embed
-- ambiguous and break the currently deployed app the moment this runs.
-- (Accounts are deactivated, never deleted, so a dangling id isn't a risk.)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_account_id uuid;                                                -- the other own account
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_peer_id    uuid REFERENCES transactions(id) ON DELETE SET NULL;  -- the matching leg, if we hold it
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS duplicate_of_id     uuid REFERENCES transactions(id) ON DELETE SET NULL;  -- suspected original
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS review_flags        text[] NOT NULL DEFAULT '{}';
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_review_flags_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_review_flags_check
  CHECK (review_flags <@ ARRAY['suspected_transfer','suspected_duplicate']::text[]);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_review boolean GENERATED ALWAYS AS (cardinality(review_flags) > 0) STORED;

-- Dedupe: one fingerprint per account. A plain UNIQUE (not a partial index) so
-- PostgREST upsert(onConflict) can use it; NULLs (manual rows) never collide.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_account_external_id_key;
ALTER TABLE transactions ADD CONSTRAINT transactions_account_external_id_key UNIQUE (account_id, external_id);

CREATE INDEX IF NOT EXISTS transactions_account_date_idx ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS transactions_needs_review_idx ON transactions(date) WHERE needs_review;
CREATE INDEX IF NOT EXISTS transactions_import_batch_idx ON transactions(import_batch_id);

-- ────────────────────────────────────────────────────────────
-- 6. Light budgets: one monthly target per category, versioned by month
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id      uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  monthly_cents    bigint NOT NULL CHECK (monthly_cents >= 0),   -- spend target, positive AUD cents
  effective_from   date NOT NULL DEFAULT date_trunc('month', now())::date CHECK (extract(day FROM effective_from) = 1),
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz DEFAULT now(),
  UNIQUE (category_id, effective_from)
);

-- ────────────────────────────────────────────────────────────
-- 7. Scenarios + assumptions
--    A scenario is a fork of its parent; assumptions on a fork override only
--    the keys they set (resolution lives in src/lib/assumptions.ts).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scenarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  description         text,
  is_baseline         boolean NOT NULL DEFAULT false,
  parent_scenario_id  uuid REFERENCES scenarios(id) ON DELETE SET NULL,
  is_archived         boolean NOT NULL DEFAULT false,
  sort_order          int NOT NULL DEFAULT 0,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now(),
  CHECK (NOT (is_baseline AND parent_scenario_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS scenarios_one_baseline ON scenarios ((true)) WHERE is_baseline;

CREATE TABLE IF NOT EXISTS assumptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),   -- registry: src/lib/assumptions.ts
  value        numeric NOT NULL,
  notes        text,
  updated_by   uuid REFERENCES auth.users(id),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (scenario_id, key)
);

-- ────────────────────────────────────────────────────────────
-- 8. Life events + planned cashflows
--    Generalises the wedding, planned_outflows and recurring_transactions.
--    scenario_id NULL = part of the shared plan (every scenario sees it);
--    set = only in that scenario (e.g. "Buy Sep-27 $850k").
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS life_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id   uuid REFERENCES scenarios(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('house_purchase','wedding','travel','leave','income_change','one_off','other')),
  event_date    date NOT NULL,              -- the pin on the Future timeline
  end_date      date,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','cancelled')),
  currency      text NOT NULL DEFAULT 'AUD',
  budget_cents  bigint,                     -- total budget in `currency`, positive
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- kind-specific (house: price, deposit, state, ...)
  is_archived   boolean NOT NULL DEFAULT false,      -- archived events move to More › Archive
  notes         text,
  sort_order    int NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= event_date)
);

CREATE TABLE IF NOT EXISTS planned_cashflows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid REFERENCES scenarios(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES life_events(id) ON DELETE CASCADE,
  description     text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('income','expense','transfer','super_contribution')),
  person_key      text REFERENCES people(key) ON UPDATE CASCADE,   -- whose salary / super; NULL = household
  amount_cents    bigint NOT NULL,          -- signed, native currency, per occurrence
  currency        text NOT NULL DEFAULT 'AUD',
  is_gross        boolean NOT NULL DEFAULT false,  -- salary entered gross (Phase 2 tax engine derives take-home)
  frequency       text NOT NULL DEFAULT 'once' CHECK (frequency IN ('once','weekly','fortnightly','monthly','quarterly','annual')),
  start_date      date NOT NULL,
  end_date        date,
  indexation      text NOT NULL DEFAULT 'none' CHECK (indexation IN ('none','inflation','wages','custom')),
  indexation_pct  numeric(6,3),             -- when indexation = 'custom'
  category_id     uuid REFERENCES categories(id) ON DELETE SET NULL,
  account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,   -- paid from / into
  to_account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,   -- transfers only
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','paid','cancelled')),
  source_table    text,                     -- backfill provenance ('planned_outflows', ...)
  source_id       uuid,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (kind <> 'transfer' OR to_account_id IS NOT NULL),
  CHECK (indexation <> 'custom' OR indexation_pct IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS planned_cashflows_source_key ON planned_cashflows(source_table, source_id);
CREATE INDEX IF NOT EXISTS planned_cashflows_start_idx ON planned_cashflows(start_date);

-- Link existing wedding items to the generic event (filled by 0008)
ALTER TABLE wedding_items ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES life_events(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 9. FX: record where a rate came from (written by /api/fx/refresh)
-- ────────────────────────────────────────────────────────────
ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS source     text;
ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS fetched_at timestamptz DEFAULT now();

-- ────────────────────────────────────────────────────────────
-- 10. Data freshness per account
--     security_invoker → the caller's RLS applies to the underlying tables.
--     data_as_of = the later of the last balance snapshot and the last
--     imported statement date (manual one-off transactions don't count).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW account_freshness WITH (security_invoker = true) AS
SELECT
  a.id                                         AS account_id,
  (SELECT max(t.date) FROM transactions t WHERE t.account_id = a.id)            AS last_transaction_date,
  (SELECT max(s.date) FROM account_snapshots s WHERE s.account_id = a.id)      AS last_snapshot_date,
  (SELECT max(b.created_at) FROM import_batches b WHERE b.account_id = a.id)   AS last_import_at,
  (SELECT max(b.date_to) FROM import_batches b WHERE b.account_id = a.id)      AS last_import_through,
  GREATEST(
    (SELECT max(s.date) FROM account_snapshots s WHERE s.account_id = a.id),
    (SELECT max(b.date_to) FROM import_batches b WHERE b.account_id = a.id)
  )                                            AS data_as_of
FROM accounts a;

-- ────────────────────────────────────────────────────────────
-- 11. RLS (same shape as 0002/0005)
-- ────────────────────────────────────────────────────────────
ALTER TABLE people            ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assumptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_cashflows ENABLE ROW LEVEL SECURITY;

-- Reference-style tables: full access for household members
DROP POLICY IF EXISTS "Household members" ON people;
CREATE POLICY "Household members" ON people      FOR ALL USING (is_household_member(auth.uid())) WITH CHECK (is_household_member(auth.uid()));
DROP POLICY IF EXISTS "Household members" ON assumptions;
CREATE POLICY "Household members" ON assumptions FOR ALL USING (is_household_member(auth.uid())) WITH CHECK (is_household_member(auth.uid()));

-- User-written tables: read/update/delete for members, insert stamped with creator
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_batches','budgets','scenarios','life_events','planned_cashflows'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Household members can read" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can insert own" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can update" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Household members can delete" ON %I', t);
    EXECUTE format('CREATE POLICY "Household members can read" ON %I FOR SELECT USING (is_household_member(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Household members can insert own" ON %I FOR INSERT WITH CHECK (is_household_member(auth.uid()) AND created_by = auth.uid())', t);
    EXECUTE format('CREATE POLICY "Household members can update" ON %I FOR UPDATE USING (is_household_member(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Household members can delete" ON %I FOR DELETE USING (is_household_member(auth.uid()))', t);
  END LOOP;
END $$;

GRANT SELECT ON account_freshness TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 12. Audit triggers (generic function from 0003)
--     Also covers categories + fx_rates, which 0003 missed.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['people','import_batches','budgets','scenarios','assumptions','life_events','planned_cashflows','categories','fx_rates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_' || t, t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()', 'audit_' || t, t);
  END LOOP;
END $$;

COMMIT;
