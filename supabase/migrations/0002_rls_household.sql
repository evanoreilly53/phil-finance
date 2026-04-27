-- ============================================================
-- Migration 0002: Tighten RLS to household allowlist
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Household allowlist table
CREATE TABLE IF NOT EXISTS household_members (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name text NOT NULL
);

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;

INSERT INTO household_members (user_id, display_name) VALUES
  ('bebcd4ba-d090-4852-9dbf-14f5630f2978', 'Evan'),
  ('875d8790-8875-4e00-8770-f706430fff68', 'Rachel')
ON CONFLICT (user_id) DO NOTHING;

-- 2. Helper (SECURITY DEFINER bypasses RLS on the allowlist table itself)
CREATE OR REPLACE FUNCTION is_household_member(uid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM household_members WHERE user_id = uid);
$$;

-- 3. Self-referential policy on allowlist (read-only, no writes via app)
CREATE POLICY "Household members can view allowlist"
  ON household_members FOR SELECT
  USING (is_household_member(auth.uid()));

-- 4. Drop all old wide-open "authenticated = full access" policies
DROP POLICY IF EXISTS "Authenticated users have full access" ON accounts;
DROP POLICY IF EXISTS "Authenticated users have full access" ON categories;
DROP POLICY IF EXISTS "Authenticated users have full access" ON transactions;
DROP POLICY IF EXISTS "Authenticated users have full access" ON account_snapshots;
DROP POLICY IF EXISTS "Authenticated users have full access" ON goals;
DROP POLICY IF EXISTS "Authenticated users have full access" ON planned_outflows;
DROP POLICY IF EXISTS "Authenticated users have full access" ON wedding_items;
DROP POLICY IF EXISTS "Authenticated users have full access" ON audit_log;
DROP POLICY IF EXISTS "Authenticated users have full access" ON fx_rates;
DROP POLICY IF EXISTS "Authenticated users have full access" ON app_settings;

-- 5. Simple read/write for reference tables (no created_by column)
CREATE POLICY "Household members" ON accounts         FOR ALL USING (is_household_member(auth.uid()));
CREATE POLICY "Household members" ON categories       FOR ALL USING (is_household_member(auth.uid()));
CREATE POLICY "Household members" ON fx_rates         FOR ALL USING (is_household_member(auth.uid()));
CREATE POLICY "Household members" ON goals            FOR ALL USING (is_household_member(auth.uid()));
CREATE POLICY "Household members" ON planned_outflows FOR ALL USING (is_household_member(auth.uid()));
CREATE POLICY "Household members" ON wedding_items    FOR ALL USING (is_household_member(auth.uid()));

-- Ensure RLS is enabled on app_settings (set in 0001 but idempotent to restate)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household members" ON app_settings FOR ALL USING (is_household_member(auth.uid()));

-- 6. Transactions — creator scoping on write
CREATE POLICY "Household members can read"
  ON transactions FOR SELECT
  USING (is_household_member(auth.uid()));

CREATE POLICY "Household members can insert own"
  ON transactions FOR INSERT
  WITH CHECK (is_household_member(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Household members can update"
  ON transactions FOR UPDATE
  USING (is_household_member(auth.uid()));

CREATE POLICY "Household members can delete"
  ON transactions FOR DELETE
  USING (is_household_member(auth.uid()));

-- 7. Account snapshots — creator scoping on insert
CREATE POLICY "Household members can read"
  ON account_snapshots FOR SELECT
  USING (is_household_member(auth.uid()));

CREATE POLICY "Household members can insert own"
  ON account_snapshots FOR INSERT
  WITH CHECK (is_household_member(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Household members can update"
  ON account_snapshots FOR UPDATE
  USING (is_household_member(auth.uid()));

CREATE POLICY "Household members can delete"
  ON account_snapshots FOR DELETE
  USING (is_household_member(auth.uid()));

-- 8. Audit log — read-only for household members
--    (writes happen via SECURITY DEFINER trigger in 0003_audit_triggers.sql)
CREATE POLICY "Household members can read"
  ON audit_log FOR SELECT
  USING (is_household_member(auth.uid()));
