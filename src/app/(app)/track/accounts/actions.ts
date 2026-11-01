'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AccountType, ImportProfile } from '@/lib/supabase/database.types'

const LIABILITY_TYPES: readonly AccountType[] = ['credit_card', 'mortgage', 'loan', 'other_liability']
const ALL_TYPES: readonly AccountType[] = [
  'bank', 'savings', 'offset', 'cash', 'investment', 'super', 'property', 'other_asset', 'wedding',
  'credit_card', 'mortgage', 'loan', 'other_liability',
]

export type AccountInput = {
  id?: string
  name: string
  type: AccountType
  owner: 'joint' | 'rachel' | 'evan'
  currency: string
  is_liquid: boolean
  institution: string | null
  account_number_hint: string | null
  import_profile: ImportProfile | null
  interest_rate_pct: number | null
  offset_account_id: string | null
  loan_original_cents: number | null
  loan_start_date: string | null
  loan_term_months: number | null
  loan_repayment_cents: number | null
  loan_repayment_freq: 'weekly' | 'fortnightly' | 'monthly' | null
  super_fund: string | null
}

export async function saveAccount(input: AccountInput): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const name = input.name.trim()
  if (!name) return { error: 'Name is required' }
  if (!ALL_TYPES.includes(input.type)) return { error: 'Unknown account type' }
  if (!['joint', 'rachel', 'evan'].includes(input.owner)) return { error: 'Unknown owner' }
  const hint = input.account_number_hint?.replace(/\D/g, '') || null
  if (hint && !/^\d{3,6}$/.test(hint)) return { error: 'Account number hint should be the last 3–6 digits' }
  const currency = (input.currency || 'AUD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code' }

  const isLiability = LIABILITY_TYPES.includes(input.type)
  const isLoan = input.type === 'mortgage' || input.type === 'loan'
  const row = {
    name,
    type: input.type,
    kind: (isLiability ? 'liability' : 'asset') as 'asset' | 'liability',
    owner: input.owner,
    currency,
    is_liquid: isLiability ? false : input.is_liquid,
    institution: input.institution?.trim() || null,
    account_number_hint: hint,
    import_profile: input.import_profile,
    interest_rate_pct: input.interest_rate_pct,
    offset_account_id: isLoan ? input.offset_account_id : null,
    loan_original_cents: isLoan ? input.loan_original_cents : null,
    loan_start_date: isLoan ? input.loan_start_date : null,
    loan_term_months: isLoan ? input.loan_term_months : null,
    loan_repayment_cents: isLoan ? input.loan_repayment_cents : null,
    loan_repayment_freq: isLoan ? input.loan_repayment_freq : null,
    super_fund: input.type === 'super' ? input.super_fund?.trim() || null : null,
  }

  const q = input.id
    ? supabase.from('accounts').update(row).eq('id', input.id).select('id')
    : supabase.from('accounts').insert(row).select('id')
  const { data, error } = await q
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'Nothing was saved' }

  revalidatePath('/track/accounts')
  revalidatePath('/networth')
  revalidatePath('/dashboard')
  return {}
}
