/** Category names that support slab/remnant length, width, and square footage. */
export const DIMENSION_CATEGORY_NAMES = ["Natural Stone", "Quartz"] as const

export type DimensionCategoryName = (typeof DIMENSION_CATEGORY_NAMES)[number]

export type CategoryRef = { id: string; name: string }

export function categorySupportsDimensions(categoryName: string | null | undefined): boolean {
  if (!categoryName) return false
  const normalized = categoryName.trim().toLowerCase()
  return DIMENSION_CATEGORY_NAMES.some((name) => name.toLowerCase() === normalized)
}

export function categoryIdSupportsDimensions(
  categoryId: string | null | undefined,
  categories: CategoryRef[],
): boolean {
  if (!categoryId) return false
  const category = categories.find((entry) => entry.id === categoryId)
  return categorySupportsDimensions(category?.name)
}

export function calculateSquareFeet(
  lengthInches: number | null | undefined,
  widthInches: number | null | undefined,
): number | null {
  if (lengthInches == null || widthInches == null) return null
  if (!Number.isFinite(lengthInches) || !Number.isFinite(widthInches)) return null
  if (lengthInches <= 0 || widthInches <= 0) return null
  return (lengthInches * widthInches) / 144
}

export function calculateSquareFeetFromStrings(length: string, width: string): string {
  const lengthValue = length.trim() === "" ? null : Number(length)
  const widthValue = width.trim() === "" ? null : Number(width)
  const squareFeet = calculateSquareFeet(lengthValue, widthValue)
  if (squareFeet == null) return ""
  return formatSquareFeetNumber(squareFeet)
}

export function formatSquareFeetNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0"
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "")
}

export function formatDimensionInches(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const rounded = Math.round(value * 100) / 100
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "")
  return `${label}"`
}

export function formatDimensionsSizeLine(
  lengthInches: number | null | undefined,
  widthInches: number | null | undefined,
): string {
  return `${formatDimensionInches(lengthInches)} × ${formatDimensionInches(widthInches)}`
}

export function formatDimensionsSquareFeetLine(squareFeet: number | null | undefined): string {
  return `${formatSquareFeetNumber(squareFeet)} sq ft`
}

export type DimensionPayload = {
  length_inches: number | null
  width_inches: number | null
  square_feet: number | null
}

export function buildDimensionPayload(
  categoryId: string,
  categories: CategoryRef[],
  lengthInches: string,
  widthInches: string,
): DimensionPayload {
  if (!categoryIdSupportsDimensions(categoryId, categories)) {
    return { length_inches: null, width_inches: null, square_feet: null }
  }

  const length = lengthInches.trim() === "" ? null : Number(lengthInches)
  const width = widthInches.trim() === "" ? null : Number(widthInches)
  const squareFeet = calculateSquareFeet(length, width)

  return {
    length_inches: length != null && Number.isFinite(length) ? length : null,
    width_inches: width != null && Number.isFinite(width) ? width : null,
    square_feet: squareFeet,
  }
}
