-- ============================================================
-- Personal Finance App — Supabase Schema
-- Run this in the Supabase SQL editor after creating your project
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- ACCOUNTS
-- ============================================================
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null check (type in ('bank','investment','super','savings','wedding')),
  currency text not null default 'AUD',
  owner text not null check (owner in ('joint','rachel','evan')),
  is_liquid boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- Seed accounts
insert into accounts (name, type, currency, owner, is_liquid) values
  ('Joint Bank', 'bank', 'AUD', 'joint', true),
  ('Wedding Account', 'savings', 'AUD', 'joint', true),
  ('Rachel Bank', 'bank', 'AUD', 'rachel', true),
  ('Evan Bank', 'bank', 'AUD', 'evan', true),
  ('Irish Bank', 'bank', 'EUR', 'joint', true),
  ('Vanguard ETF', 'investment', 'AUD', 'joint', false),
  ('eToro', 'investment', 'AUD', 'joint', false),
  ('Rachel Super', 'super', 'AUD', 'rachel', false),
  ('Evan Super', 'super', 'AUD', 'evan', false);

-- ============================================================
-- CATEGORIES
-- ============================================================
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  parent_id uuid references categories(id),
  owner text not null check (owner in ('joint','rachel','evan','any')),
  colour text,
  sort_order int default 0
);

-- Top-level joint categories
insert into categories (name, owner, colour, sort_order) values
  ('Housing/Utilities', 'joint', '#6366f1', 1),
  ('Groceries', 'joint', '#22c55e', 2),
  ('Insurance', 'joint', '#f59e0b', 3),
  ('Subscriptions', 'joint', '#8b5cf6', 4),
  ('Car', 'joint', '#ef4444', 5),
  ('Entertainment/Eating Out', 'joint', '#ec4899', 6),
  ('Miscellaneous', 'joint', '#6b7280', 7),
  ('Rachel Personal', 'rachel', '#f472b6', 8),
  ('Evan Personal', 'evan', '#38bdf8', 9),
  ('Large One-Off', 'any', '#f97316', 10);

-- Housing sub-categories
insert into categories (name, parent_id, owner, sort_order)
select sub.name, c.id, 'joint', sub.sort_order
from (values
  ('Rent', 1), ('Electricity', 2), ('Hot Water/Gas', 3),
  ('Air-Con', 4), ('WiFi', 5), ('Water', 6), ('Phone Bills', 7)
) as sub(name, sort_order)
cross join (select id from categories where name = 'Housing/Utilities') c;

-- Rachel personal sub-categories
insert into categories (name, parent_id, owner, sort_order)
select sub.name, c.id, 'rachel', sub.sort_order
from (values
  ('Toiletries', 1), ('Beauty', 2), ('Apple', 3), ('Gym/Classes', 4),
  ('Gifts', 5), ('Eating Out', 6), ('Shopping', 7), ('Travel/Ubers', 8), ('Misc', 9)
) as sub(name, sort_order)
cross join (select id from categories where name = 'Rachel Personal') c;

-- Evan personal sub-categories
insert into categories (name, parent_id, owner, sort_order)
select sub.name, c.id, 'evan', sub.sort_order
from (values
  ('Entertainment', 1), ('Phone', 2), ('Going Out', 3), ('Soccer', 4),
  ('Stocks', 5), ('Eating Out', 6), ('Shopping', 7), ('Travel/Ubers', 8),
  ('Chump Treats', 9), ('Misc', 10)
) as sub(name, sort_order)
cross join (select id from categories where name = 'Evan Personal') c;

-- ============================================================
-- FX RATES
-- ============================================================
create table fx_rates (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  from_currency text not null,
  to_currency text not null default 'AUD',
  rate numeric(12,6) not null,
  unique(date, from_currency, to_currency)
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
create table transactions (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  description text not null,
  amount_cents bigint not null,         -- in original currency, cents
  currency text not null default 'AUD',
  aud_amount_cents bigint not null,     -- AUD equivalent at time of transaction
  fx_rate numeric(12,6) default 1,
  account_id uuid references accounts(id),
  category_id uuid references categories(id),
  owner text not null check (owner in ('joint','rachel','evan')),
  is_large_one_off boolean not null default false,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index transactions_date_idx on transactions(date);
create index transactions_category_idx on transactions(category_id);
create index transactions_owner_idx on transactions(owner);

-- ============================================================
-- ACCOUNT SNAPSHOTS (net worth valuations)
-- ============================================================
create table account_snapshots (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  account_id uuid references accounts(id) not null,
  balance_cents bigint not null,        -- in account's native currency
  currency text not null default 'AUD',
  aud_balance_cents bigint not null,    -- AUD equivalent
  fx_rate numeric(12,6) default 1,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique(date, account_id)
);

create index snapshots_date_idx on account_snapshots(date);

-- ============================================================
-- GOALS
-- ============================================================
create table goals (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner text not null check (owner in ('joint','rachel','evan')),
  target_cents bigint not null,
  current_cents bigint not null default 0,
  cadence text check (cadence in ('weekly','monthly','annual','one-off')),
  target_date date,
  is_active boolean default true,
  sort_order int default 0
);

insert into goals (name, owner, target_cents, cadence, target_date, sort_order) values
  ('Joint Weekly Savings', 'joint', 80000, 'weekly', null, 1),
  ('Rachel Savings 2026', 'rachel', 500000, 'annual', '2026-12-31', 2),
  ('Net Worth $250k', 'joint', 25000000, 'one-off', '2026-12-31', 3),
  ('Ultimate Goal $2M', 'joint', 200000000, 'one-off', null, 4);

-- ============================================================
-- PLANNED OUTFLOWS (known large upcoming payments)
-- ============================================================
create table planned_outflows (
  id uuid primary key default uuid_generate_v4(),
  description text not null,
  amount_cents bigint not null,         -- AUD
  due_date date not null,
  account_id uuid references accounts(id),
  status text not null default 'planned' check (status in ('planned','paid','cancelled')),
  category text,
  notes text,
  created_at timestamptz default now()
);

-- Seed 2026 known outflows
insert into planned_outflows (description, amount_cents, due_date, status, category) values
  ('Permanent Residency Application', 1000000, '2026-01-31', 'planned', 'Large One-Off'),
  ('Europe Flights', 500000, '2026-01-31', 'planned', 'Large One-Off'),
  ('Castlemartyr – 50% Deposit', 2000000, '2026-05-31', 'planned', 'Wedding'),
  ('Castlemartyr – Final 50%', 2000000, '2026-12-01', 'planned', 'Wedding'),
  ('Wedding Balance', 3000000, '2026-12-01', 'planned', 'Wedding');

-- ============================================================
-- WEDDING ITEMS
-- ============================================================
create table wedding_items (
  id uuid primary key default uuid_generate_v4(),
  item text not null,
  budget_aud_cents bigint,
  budget_eur_cents bigint,
  spent_aud_cents bigint default 0,
  spent_eur_cents bigint default 0,
  balance_owed_eur_cents bigint default 0,
  date_paid date,
  account_id uuid references accounts(id),
  status text default 'pending' check (status in ('pending','deposit_paid','paid','cancelled')),
  notes text,
  link text,
  sort_order int default 0
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table account_snapshots enable row level security;
alter table goals enable row level security;
alter table planned_outflows enable row level security;
alter table wedding_items enable row level security;
alter table audit_log enable row level security;
alter table fx_rates enable row level security;

-- All authenticated users can read/write everything (household app, two-person trust model)
create policy "Authenticated users have full access" on accounts for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on categories for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on transactions for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on account_snapshots for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on goals for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on planned_outflows for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on wedding_items for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on audit_log for all using (auth.role() = 'authenticated');
create policy "Authenticated users have full access" on fx_rates for all using (auth.role() = 'authenticated');
