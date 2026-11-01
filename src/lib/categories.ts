// Category tree helpers (2-level: parent → child).

export type CategoryNode = { id: string; name: string; parent_id: string | null }

/** Top-level (parent) name for a transaction's category, or 'Uncategorised'. */
export function resolveParentName(
  catId: string | null,
  joined: CategoryNode | null,
  allCats: readonly CategoryNode[],
): string {
  if (!catId || !joined) return 'Uncategorised'
  if (!joined.parent_id) return joined.name
  const parent = allCats.find(c => c.id === joined.parent_id)
  return parent?.name ?? joined.name
}

/**
 * True if the category IS `name` or sits under a parent called `name`
 * (case-insensitive). e.g. 'Rent' is a child of 'Housing/Utilities', so a
 * parent-only check never matches it.
 */
export function isCategoryOrChildOf(
  joined: CategoryNode | null,
  allCats: readonly CategoryNode[],
  name: string,
): boolean {
  if (!joined) return false
  const target = name.toLowerCase()
  if (joined.name.toLowerCase() === target) return true
  if (!joined.parent_id) return false
  const parent = allCats.find(c => c.id === joined.parent_id)
  return parent?.name.toLowerCase() === target
}
