import type { OwnerKey } from './types'

export const OWNER_BADGE: Record<OwnerKey, string> = {
  joint:  'bg-indigo-500/20 text-indigo-300',
  rachel: 'bg-pink-500/20 text-pink-300',
  evan:   'bg-sky-500/20 text-sky-300',
}

export const OWNER_TEXT: Record<OwnerKey, string> = {
  joint:  'text-indigo-300',
  rachel: 'text-pink-300',
  evan:   'text-sky-300',
}

export const OWNER_HEX: Record<OwnerKey, string> = {
  joint:  '#818cf8',
  rachel: '#f472b6',
  evan:   '#60a5fa',
}
