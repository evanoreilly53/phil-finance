export type OwnerKey = 'joint' | 'rachel' | 'evan'
export type OwnerKeyAny = OwnerKey | 'any'
export type AccountType = 'bank' | 'investment' | 'super' | 'savings' | 'wedding'
export type Currency = 'AUD' | 'EUR' | 'USD' | 'GBP'
export type Cents = number & { readonly __brand: 'Cents' }
export function asCents(n: number): Cents { return n as Cents }
export type OutflowStatus = 'planned' | 'paid' | 'cancelled'
export type WeddingItemStatus = 'pending' | 'deposit_paid' | 'paid' | 'cancelled'
export type GoalCadence = 'weekly' | 'monthly' | 'annual' | 'one-off'
export const OWNERS = ['joint', 'rachel', 'evan'] as const
