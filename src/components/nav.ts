// Navigation map for the Phase 1 shell: Home · Track · Future · House · More.
// Existing URLs are kept (bookmarks and the installed PWA keep working); pages
// are grouped under a section by path prefix.

export type Section = 'home' | 'track' | 'future' | 'house' | 'more'

const SECTION_PREFIXES: [Section, string[]][] = [
  ['home',   ['/dashboard']],
  ['track',  ['/track', '/spending', '/income', '/transactions', '/networth']],
  ['future', ['/future', '/goals']],
  ['house',  ['/house']],
  ['more',   ['/more', '/settings', '/wedding', '/insights']],
]

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export function sectionFor(pathname: string): Section | null {
  for (const [section, prefixes] of SECTION_PREFIXES) {
    if (prefixes.some(p => under(pathname, p))) return section
  }
  return null
}

export const TRACK_TABS = [
  { href: '/spending',       label: 'Spending',     match: ['/spending'] },
  { href: '/income',         label: 'Income',       match: ['/income'] },
  { href: '/transactions',   label: 'Transactions', match: ['/transactions'] },
  { href: '/track/accounts', label: 'Accounts',     match: ['/track/accounts', '/networth'] },
] as const

export function activeTrackTab(pathname: string): string | null {
  return TRACK_TABS.find(t => t.match.some(m => under(pathname, m)))?.href ?? null
}

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard':            'Home',
  '/spending':             'Spending',
  '/networth':             'Net Worth',
  '/wedding':              'Our Wedding 2026',
  '/goals':                'Goals',
  '/transactions':         'Transactions',
  '/transactions/import':  'Import',
  '/transactions/review':  'Review',
  '/insights':             'Insights',
  '/income':               'Income',
  '/settings':             'Settings',
  '/track/accounts':       'Accounts',
  '/future':               'Future',
  '/house':                'House',
  '/more':                 'More',
  '/more/budgets':         'Budgets',
}
