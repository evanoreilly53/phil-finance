-- Phase update: new planned outflows, house goal, business investment account
-- Run in Supabase Dashboard → SQL Editor

-- ── Planned outflows ──────────────────────────────────────────────────────────

insert into planned_outflows (description, amount_cents, due_date, status, category, notes) values
  ('Holiday',                          300000,   '2026-05-15', 'planned', 'Travel',      'May trip'),
  ('Family Trust Setup',               200000,   '2026-05-31', 'planned', 'Legal',       'Trust establishment fee'),
  ('Permanent Residency Application',  900000,   '2026-06-15', 'planned', 'Legal',       'PR application costs'),
  ('Tax Bill',                         300000,   '2026-06-30', 'planned', 'Tax',         'End of financial year'),
  ('Business Investment',             3000000,   '2026-07-01', 'planned', 'Investment',  'Equity stake — will appear as Business Venture asset on NW');

-- ── Business Venture investment account ──────────────────────────────────────
-- Not liquid (equity, not cash). Add snapshots manually as the value changes.

insert into accounts (name, type, currency, owner, is_liquid, is_active) values
  ('Business Venture', 'investment', 'AUD', 'joint', false, true);

-- ── House Deposit goal ────────────────────────────────────────────────────────
-- $1M Perth property, target 20% deposit ($200k) + stamp duty + costs ≈ $250k
-- Targeting end of 2028.

insert into goals (name, kind, owner, target_cents, current_cents, cadence, target_date, is_active, sort_order) values
  ('House Deposit — Perth', 'custom', 'joint', 25000000, 0, 'monthly', '2028-12-31', true, 10);
