export function isItemOnHold(holdLastName: string | null | undefined): boolean {
  return !!(holdLastName && holdLastName.trim())
}

export function formatHoldLastName(value: string): string {
  return value.trim()
}
