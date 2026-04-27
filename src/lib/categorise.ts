type Rule = {
  pattern: string
  category_id: string
  owner: string | null
  priority: number
  is_active: boolean
}

export function matchCategory(description: string, owner: string, rules: Rule[]): string | null {
  const active = rules
    .filter(r => r.is_active && (r.owner === null || r.owner === owner))
    .sort((a, b) => b.priority - a.priority)

  for (const rule of active) {
    try {
      if (new RegExp(rule.pattern, 'i').test(description)) {
        return rule.category_id
      }
    } catch {
      // skip malformed regex
    }
  }
  return null
}
