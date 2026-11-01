// Hand-crafted from supabase/schema.sql + migrations 0001–0008 — regenerate with:
// npx supabase gen types typescript --project-id ujxsdoqqfmnvbpesesmd > src/lib/supabase/database.types.ts
// (requires: supabase login or SUPABASE_ACCESS_TOKEN)

export type AccountType =
  | 'bank' | 'investment' | 'super' | 'savings' | 'wedding'
  | 'offset' | 'cash' | 'property' | 'other_asset'
  | 'credit_card' | 'mortgage' | 'loan' | 'other_liability'
export type ImportProfile = 'commbank' | 'generic'
export type CategoryKind = 'income' | 'essential' | 'discretionary' | 'savings' | 'transfer'
export type ReviewFlag = 'suspected_transfer' | 'suspected_duplicate'
export type LifeEventKind = 'house_purchase' | 'wedding' | 'travel' | 'leave' | 'income_change' | 'one_off' | 'other'
export type LifeEventStatus = 'planned' | 'done' | 'cancelled'
export type CashflowKind = 'income' | 'expense' | 'transfer' | 'super_contribution'
export type CashflowFrequency = 'once' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: string
          name: string
          type: AccountType
          currency: string
          owner: 'joint' | 'rachel' | 'evan'
          is_liquid: boolean
          is_active: boolean
          created_at: string | null
          kind: 'asset' | 'liability'
          institution: string | null
          account_number_hint: string | null
          import_profile: ImportProfile | null
          interest_rate_pct: number | null
          expected_return_pct: number | null
          annual_fee_cents: number | null
          fee_pct: number | null
          loan_original_cents: number | null
          loan_start_date: string | null
          loan_term_months: number | null
          loan_repayment_cents: number | null
          loan_repayment_freq: 'weekly' | 'fortnightly' | 'monthly' | null
          loan_interest_only: boolean
          offset_account_id: string | null
          super_fund: string | null
          sort_order: number
          notes: string | null
        }
        Insert: {
          id?: string
          name: string
          type: AccountType
          currency?: string
          owner: 'joint' | 'rachel' | 'evan'
          is_liquid?: boolean
          is_active?: boolean
          created_at?: string | null
          kind?: 'asset' | 'liability'
          institution?: string | null
          account_number_hint?: string | null
          import_profile?: ImportProfile | null
          interest_rate_pct?: number | null
          expected_return_pct?: number | null
          annual_fee_cents?: number | null
          fee_pct?: number | null
          loan_original_cents?: number | null
          loan_start_date?: string | null
          loan_term_months?: number | null
          loan_repayment_cents?: number | null
          loan_repayment_freq?: 'weekly' | 'fortnightly' | 'monthly' | null
          loan_interest_only?: boolean
          offset_account_id?: string | null
          super_fund?: string | null
          sort_order?: number
          notes?: string | null
        }
        Update: {
          id?: string
          name?: string
          type?: AccountType
          currency?: string
          owner?: 'joint' | 'rachel' | 'evan'
          is_liquid?: boolean
          is_active?: boolean
          created_at?: string | null
          kind?: 'asset' | 'liability'
          institution?: string | null
          account_number_hint?: string | null
          import_profile?: ImportProfile | null
          interest_rate_pct?: number | null
          expected_return_pct?: number | null
          annual_fee_cents?: number | null
          fee_pct?: number | null
          loan_original_cents?: number | null
          loan_start_date?: string | null
          loan_term_months?: number | null
          loan_repayment_cents?: number | null
          loan_repayment_freq?: 'weekly' | 'fortnightly' | 'monthly' | null
          loan_interest_only?: boolean
          offset_account_id?: string | null
          super_fund?: string | null
          sort_order?: number
          notes?: string | null
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
          kind: CategoryKind
        }
        Insert: {
          id?: string
          name: string
          parent_id?: string | null
          owner: 'joint' | 'rachel' | 'evan' | 'any'
          colour?: string | null
          sort_order?: number | null
          kind?: CategoryKind
        }
        Update: {
          id?: string
          name?: string
          parent_id?: string | null
          owner?: 'joint' | 'rachel' | 'evan' | 'any'
          colour?: string | null
          sort_order?: number | null
          kind?: CategoryKind
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
          source: string | null
          fetched_at: string | null
        }
        Insert: {
          id?: string
          date: string
          from_currency: string
          to_currency?: string
          rate: number
          source?: string | null
          fetched_at?: string | null
        }
        Update: {
          id?: string
          date?: string
          from_currency?: string
          to_currency?: string
          rate?: number
          source?: string | null
          fetched_at?: string | null
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
          external_id: string | null
          import_batch_id: string | null
          balance_after_cents: number | null
          is_transfer: boolean
          transfer_account_id: string | null
          transfer_peer_id: string | null
          duplicate_of_id: string | null
          review_flags: ReviewFlag[]
          needs_review: boolean
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
          external_id?: string | null
          import_batch_id?: string | null
          balance_after_cents?: number | null
          is_transfer?: boolean
          transfer_account_id?: string | null
          transfer_peer_id?: string | null
          duplicate_of_id?: string | null
          review_flags?: ReviewFlag[]
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
          external_id?: string | null
          import_batch_id?: string | null
          balance_after_cents?: number | null
          is_transfer?: boolean
          transfer_account_id?: string | null
          transfer_peer_id?: string | null
          duplicate_of_id?: string | null
          review_flags?: ReviewFlag[]
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
          event_id: string | null
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
          event_id?: string | null
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
          event_id?: string | null
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
      people: {
        Row: {
          key: string
          display_name: string
          user_id: string | null
          birth_year: number | null
          has_private_hospital: boolean
          has_hecs: boolean
          sort_order: number
          created_at: string | null
        }
        Insert: {
          key: string
          display_name: string
          user_id?: string | null
          birth_year?: number | null
          has_private_hospital?: boolean
          has_hecs?: boolean
          sort_order?: number
          created_at?: string | null
        }
        Update: {
          key?: string
          display_name?: string
          user_id?: string | null
          birth_year?: number | null
          has_private_hospital?: boolean
          has_hecs?: boolean
          sort_order?: number
          created_at?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          id: string
          account_id: string | null
          profile: ImportProfile
          file_name: string | null
          row_count: number
          imported_count: number
          duplicate_count: number
          flagged_count: number
          date_from: string | null
          date_to: string | null
          closing_balance_cents: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          account_id?: string | null
          profile: ImportProfile
          file_name?: string | null
          row_count?: number
          imported_count?: number
          duplicate_count?: number
          flagged_count?: number
          date_from?: string | null
          date_to?: string | null
          closing_balance_cents?: number | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          account_id?: string | null
          profile?: ImportProfile
          file_name?: string | null
          row_count?: number
          imported_count?: number
          duplicate_count?: number
          flagged_count?: number
          date_from?: string | null
          date_to?: string | null
          closing_balance_cents?: number | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          id: string
          category_id: string
          monthly_cents: number
          effective_from: string
          notes: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          category_id: string
          monthly_cents: number
          effective_from?: string
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          category_id?: string
          monthly_cents?: number
          effective_from?: string
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      scenarios: {
        Row: {
          id: string
          name: string
          description: string | null
          is_baseline: boolean
          parent_scenario_id: string | null
          is_archived: boolean
          sort_order: number
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_baseline?: boolean
          parent_scenario_id?: string | null
          is_archived?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_baseline?: boolean
          parent_scenario_id?: string | null
          is_archived?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      assumptions: {
        Row: {
          id: string
          scenario_id: string
          key: string
          value: number
          notes: string | null
          updated_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          scenario_id: string
          key: string
          value: number
          notes?: string | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          scenario_id?: string
          key?: string
          value?: number
          notes?: string | null
          updated_by?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      life_events: {
        Row: {
          id: string
          scenario_id: string | null
          name: string
          kind: LifeEventKind
          event_date: string
          end_date: string | null
          status: LifeEventStatus
          currency: string
          budget_cents: number | null
          params: Json
          is_archived: boolean
          notes: string | null
          sort_order: number
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          scenario_id?: string | null
          name: string
          kind: LifeEventKind
          event_date: string
          end_date?: string | null
          status?: LifeEventStatus
          currency?: string
          budget_cents?: number | null
          params?: Json
          is_archived?: boolean
          notes?: string | null
          sort_order?: number
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          scenario_id?: string | null
          name?: string
          kind?: LifeEventKind
          event_date?: string
          end_date?: string | null
          status?: LifeEventStatus
          currency?: string
          budget_cents?: number | null
          params?: Json
          is_archived?: boolean
          notes?: string | null
          sort_order?: number
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      planned_cashflows: {
        Row: {
          id: string
          scenario_id: string | null
          event_id: string | null
          description: string
          kind: CashflowKind
          person_key: string | null
          amount_cents: number
          currency: string
          is_gross: boolean
          frequency: CashflowFrequency
          start_date: string
          end_date: string | null
          indexation: 'none' | 'inflation' | 'wages' | 'custom'
          indexation_pct: number | null
          category_id: string | null
          account_id: string | null
          to_account_id: string | null
          status: 'planned' | 'paid' | 'cancelled'
          source_table: string | null
          source_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          scenario_id?: string | null
          event_id?: string | null
          description: string
          kind: CashflowKind
          person_key?: string | null
          amount_cents: number
          currency?: string
          is_gross?: boolean
          frequency?: CashflowFrequency
          start_date: string
          end_date?: string | null
          indexation?: 'none' | 'inflation' | 'wages' | 'custom'
          indexation_pct?: number | null
          category_id?: string | null
          account_id?: string | null
          to_account_id?: string | null
          status?: 'planned' | 'paid' | 'cancelled'
          source_table?: string | null
          source_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          scenario_id?: string | null
          event_id?: string | null
          description?: string
          kind?: CashflowKind
          person_key?: string | null
          amount_cents?: number
          currency?: string
          is_gross?: boolean
          frequency?: CashflowFrequency
          start_date?: string
          end_date?: string | null
          indexation?: 'none' | 'inflation' | 'wages' | 'custom'
          indexation_pct?: number | null
          category_id?: string | null
          account_id?: string | null
          to_account_id?: string | null
          status?: 'planned' | 'paid' | 'cancelled'
          source_table?: string | null
          source_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      account_freshness: {
        Row: {
          account_id: string
          last_transaction_date: string | null
          last_snapshot_date: string | null
          last_import_at: string | null
          last_import_through: string | null
          data_as_of: string | null
        }
        Relationships: []
      }
    }
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
