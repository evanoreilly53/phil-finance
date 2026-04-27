import { createClient } from '@/lib/supabase/server'

// Fallback defaults mirror the values seeded in 0001_settings.sql
const DEFAULTS: Record<string, unknown> = {
  monthly_income_cents:  1256300,
  personal_budget_cents: 80000,
  wedding_budget_cents:  7500000,
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single()
    if (data) return data.value as T
  } catch {
    // fall through to default
  }
  return (DEFAULTS[key] as T) ?? fallback
}
