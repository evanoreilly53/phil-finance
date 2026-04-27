-- App settings table: stores household-wide constants
-- Run in Supabase SQL editor (Dashboard → SQL Editor)

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

insert into app_settings (key, value) values
  ('monthly_income_cents',  '1256300'),
  ('personal_budget_cents', '80000'),
  ('wedding_budget_cents',  '7500000'),
  ('household_members',     '[{"key":"rachel","label":"Rachel","income_cents":671300},{"key":"evan","label":"Evan","income_cents":585000}]');

alter table app_settings enable row level security;

create policy "Authenticated users have full access"
  on app_settings for all
  using (auth.role() = 'authenticated');
