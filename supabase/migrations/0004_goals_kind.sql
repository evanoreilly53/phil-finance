-- ============================================================
-- Migration 0004: Add kind column to goals for stable lookup
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS kind text
    CHECK (kind IN ('net_worth_milestone','net_worth_ultimate','weekly_savings','annual_savings','custom'));

-- Backfill existing seeded goals
UPDATE goals SET kind = 'weekly_savings'      WHERE name = 'Joint Weekly Savings';
UPDATE goals SET kind = 'annual_savings'      WHERE name = 'Rachel Savings 2026';
UPDATE goals SET kind = 'net_worth_milestone' WHERE name = 'Net Worth $250k';
UPDATE goals SET kind = 'net_worth_ultimate'  WHERE name = 'Ultimate Goal $2M';
