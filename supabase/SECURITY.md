# Supabase Security Configuration

## New-user signups: DISABLED

New-user signups have been disabled so that only pre-provisioned household members
(Evan and Rachel) can ever log in.

**How to verify / re-disable if reset:**
1. Supabase Dashboard → Authentication → Providers → Email
2. "Allow new users to sign up" → **OFF**
3. Save

## Household allowlist (RLS)

All table-level RLS policies gate on `is_household_member(auth.uid())`, which checks
the `household_members` table. New users must be added there manually before they can
read or write any data, regardless of whether they hold a valid auth token.

Current members:
| Name   | UUID                                   |
|--------|----------------------------------------|
| Evan   | bebcd4ba-d090-4852-9dbf-14f5630f2978  |
| Rachel | 875d8790-8875-4e00-8770-f706430fff68  |

## Service role key

The service role key bypasses RLS entirely. It was previously exposed and has been
rotated. Never commit it to source control; store only in `.env.local` (gitignored).

## Audit log

All mutations to `transactions`, `account_snapshots`, `goals`, `planned_outflows`,
`wedding_items`, `accounts`, and `app_settings` are recorded in `audit_log` via
SECURITY DEFINER triggers (see `migrations/0003_audit_triggers.sql`).
