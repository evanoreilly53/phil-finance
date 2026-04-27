// Prefix formula-injection characters so spreadsheets treat the cell as text
const FORMULA_CHARS = /^[=+\-@\t\r]/

export function csvSafe(value: string): string {
  return FORMULA_CHARS.test(value) ? `'${value}` : value
}
