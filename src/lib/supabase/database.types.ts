// Hand-crafted from supabase/schema.sql — regenerate with:
// npx supabase gen types typescript --project-id ujxsdoqqfmnvbpesesmd > src/lib/supabase/database.types.ts
// (requires: supabase login or SUPABASE_ACCESS_TOKEN)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          name: string
          type: 'bank' | 'investment' | 'super' | 'savings' | 'wedding'
          currency: string
          owner: 'joint' | 'rachel' | 'evan'
          is_liquid: boolean
          is_active: boolean
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          type: 'bank' | 'investment' | 'super' | 'savings' | 'wedding'
          currency?: string
          owner: 'joint' | 'rachel' | 'evan'
          is_liquid?: boolean
          is_active?: boolean
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          type?: 'bank' | 'investment' | 'super' | 'savings' | 'wedding'
          currency?: string
          owner?: 'joint' | 'rachel' | 'evan'
          is_liquid?: boolean
          is_active?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: string
          name: string
          parent_id: string | null
          owner: 'joint' | 'rachel' | 'evan' | 'any'
          colour: string | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          name: string
          parent_id?: string | null
          owner: 'joint' | 'rachel' | 'evan' | 'any'
          colour?: string | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          name?: string
          parent_id?: string | null
          owner?: 'joint' | 'rachel' | 'evan' | 'any'
          colour?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey'
            columns: ['parent_id']
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      fx_rates: {
        Row: {
          id: string
          date: string
          from_currency: string
          to_currency: string
          rate: number
        }
        Insert: {
          id?: string
          date: string
          from_currency: string
          to_currency?: string
          rate: number
        }
        Update: {
          id?: string
          date?: string
          from_currency?: string
          to_currency?: string
          rate?: number
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: string
          date: string
          description: string
          amount_cents: number
          currency: string
          aud_amount_cents: number
          fx_rate: number | null
          account_id: string | null
          category_id: string | null
          owner: 'joint' | 'rachel' | 'evan'
          is_large_one_off: boolean
          notes: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          date: string
          description: string
          amount_cents: number
          currency?: string
          aud_amount_cents: number
          fx_rate?: number | null
          account_id?: string | null
          category_id?: string | null
          owner: 'joint' | 'rachel' | 'evan'
          is_large_one_off?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          date?: string
          description?: string
          amount_cents?: number
          currency?: string
          aud_amount_cents?: number
          fx_rate?: number | null
          account_id?: string | null
          category_id?: string | null
          owner?: 'joint' | 'rachel' | 'evan'
          is_large_one_off?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'transactions_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'transactions_category_id_fkey'
            columns: ['category_id']
            referencedRelation: 'categories'
            referencedColumns: ['id']
          },
        ]
      }
      account_snapshots: {
        Row: {
          id: string
          date: string
          account_id: string
          balance_cents: number
          currency: string
          aud_balance_cents: number
          fx_rate: number | null
          notes: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          date: string
          account_id: string
          balance_cents: number
          currency?: string
          aud_balance_cents: number
          fx_rate?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          date?: string
          account_id?: string
          balance_cents?: number
          currency?: string
          aud_balance_cents?: number
          fx_rate?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'account_snapshots_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      goals: {
        Row: {
          id: string
          name: string
          kind: 'net_worth_milestone' | 'net_worth_ultimate' | 'weekly_savings' | 'annual_savings' | 'custom' | null
          owner: 'joint' | 'rachel' | 'evan'
          target_cents: number
          current_cents: number
          cadence: 'weekly' | 'monthly' | 'annual' | 'one-off' | null
          target_date: string | null
          is_active: boolean | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          name: string
          kind?: 'net_worth_milestone' | 'net_worth_ultimate' | 'weekly_savings' | 'annual_savings' | 'custom' | null
          owner: 'joint' | 'rachel' | 'evan'
          target_cents: number
          current_cents?: number
          cadence?: 'weekly' | 'monthly' | 'annual' | 'one-off' | null
          target_date?: string | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          name?: string
          kind?: 'net_worth_milestone' | 'net_worth_ultimate' | 'weekly_savings' | 'annual_savings' | 'custom' | null
          owner?: 'joint' | 'rachel' | 'evan'
          target_cents?: number
          current_cents?: number
          cadence?: 'weekly' | 'monthly' | 'annual' | 'one-off' | null
          target_date?: string | null
          is_active?: boolean | null
          sort_order?: number | null
        }
        Relationships: []
      }
      planned_outflows: {
        Row: {
          id: string
          description: string
          amount_cents: number
          due_date: string
          account_id: string | null
          status: 'planned' | 'paid' | 'cancelled'
          category: string | null
          notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          description: string
          amount_cents: number
          due_date: string
          account_id?: string | null
          status?: 'planned' | 'paid' | 'cancelled'
          category?: string | null
          notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          description?: string
          amount_cents?: number
          due_date?: string
          account_id?: string | null
          status?: 'planned' | 'paid' | 'cancelled'
          category?: string | null
          notes?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'planned_outflows_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      wedding_items: {
        Row: {
          id: string
          item: string
          budget_aud_cents: number | null
          budget_eur_cents: number | null
          spent_aud_cents: number | null
          spent_eur_cents: number | null
          balance_owed_eur_cents: number | null
          date_paid: string | null
          account_id: string | null
          status: 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | null
          notes: string | null
          link: string | null
          sort_order: number | null
        }
        Insert: {
          id?: string
          item: string
          budget_aud_cents?: number | null
          budget_eur_cents?: number | null
          spent_aud_cents?: number | null
          spent_eur_cents?: number | null
          balance_owed_eur_cents?: number | null
          date_paid?: string | null
          account_id?: string | null
          status?: 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | null
          notes?: string | null
          link?: string | null
          sort_order?: number | null
        }
        Update: {
          id?: string
          item?: string
          budget_aud_cents?: number | null
          budget_eur_cents?: number | null
          spent_aud_cents?: number | null
          spent_eur_cents?: number | null
          balance_owed_eur_cents?: number | null
          date_paid?: string | null
          account_id?: string | null
          status?: 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | null
          notes?: string | null
          link?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'wedding_items_account_id_fkey'
            columns: ['account_id']
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
        ]
      }
      recurring_transactions: {
        Row: {
          id: string
          description: string
          amount_cents: number
          currency: string
          category_id: string | null
          account_id: string | null
          owner: 'joint' | 'rachel' | 'evan'
          recurrence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
          day_of_month: number | null
          next_due: string
          is_active: boolean
          notes: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          description: string
          amount_cents: number
          currency?: string
          category_id?: string | null
          account_id?: string | null
          owner: 'joint' | 'rachel' | 'evan'
          recurrence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
          day_of_month?: number | null
          next_due: string
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          description?: string
          amount_cents?: number
          currency?: string
          category_id?: string | null
          account_id?: string | null
          owner?: 'joint' | 'rachel' | 'evan'
          recurrence?: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'
          day_of_month?: number | null
          next_due?: string
          is_active?: boolean
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      categorisation_rules: {
        Row: {
          id: string
          pattern: string
          category_id: string
          owner: 'joint' | 'rachel' | 'evan' | null
          priority: number
          is_active: boolean
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          pattern: string
          category_id: string
          owner?: 'joint' | 'rachel' | 'evan' | null
          priority?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          pattern?: string
          category_id?: string
          owner?: 'joint' | 'rachel' | 'evan' | null
          priority?: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          table_name: string
          record_id: string
          action: 'insert' | 'update' | 'delete'
          old_data: Json | null
          new_data: Json | null
          changed_by: string | null
          changed_at: string | null
        }
        Insert: {
          id?: string
          table_name: string
          record_id: string
          action: 'insert' | 'update' | 'delete'
          old_data?: Json | null
          new_data?: Json | null
          changed_by?: string | null
          changed_at?: string | null
        }
        Update: {
          id?: string
          table_name?: string
          record_id?: string
          action?: 'insert' | 'update' | 'delete'
          old_data?: Json | null
          new_data?: Json | null
          changed_by?: string | null
          changed_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
