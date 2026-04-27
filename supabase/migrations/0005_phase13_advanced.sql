-- Phase 13: Recurring transactions + Auto-categorisation rules
-- Run in Supabase Dashboard → SQL Editor

-- 13.1 Recurring transactions
create table if not exists recurring_transactions (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  amount_cents  bigint not null,    -- signed (negative = expense)
  currency      text not null default 'AUD',
  category_id   uuid references categories(id),
  account_id    uuid references accounts(id),
  owner         text not null check (owner in ('joint','rachel','evan')),
  recurrence    text not null check (recurrence in ('weekly','fortnightly','monthly','quarterly','annual')),
  day_of_month  int check (day_of_month between 1 and 31),  -- for monthly/quarterly/annual
  next_due      date not null,
  is_active     boolean not null default true,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz default now()
);

alter table recurring_transactions enable row level security;
create policy "household members can read recurring"  on recurring_transactions for select  using (is_household_member(auth.uid()));
create policy "household members can insert recurring" on recurring_transactions for insert with check (is_household_member(auth.uid()) and created_by = auth.uid());
create policy "household members can update recurring" on recurring_transactions for update using  (is_household_member(auth.uid()));
create policy "household members can delete recurring" on recurring_transactions for delete using  (is_household_member(auth.uid()));

-- 13.2 Auto-categorisation rules
create table if not exists categorisation_rules (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null,          -- case-insensitive regex matched against description
  category_id uuid not null references categories(id),
  owner       text check (owner in ('joint','rachel','evan')),  -- null = any owner
  priority    int not null default 0, -- higher wins on conflict
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);

alter table categorisation_rules enable row level security;
create policy "household members can read rules"   on categorisation_rules for select  using (is_household_member(auth.uid()));
create policy "household members can insert rules"  on categorisation_rules for insert with check (is_household_member(auth.uid()) and created_by = auth.uid());
create policy "household members can update rules"  on categorisation_rules for update using  (is_household_member(auth.uid()));
create policy "household members can delete rules"  on categorisation_rules for delete using  (is_household_member(auth.uid()));

-- Audit triggers for new tables
create trigger audit_recurring_transactions after insert or update or delete on recurring_transactions
  for each row execute function audit_trigger_fn();

create trigger audit_categorisation_rules after insert or update or delete on categorisation_rules
  for each row execute function audit_trigger_fn();
