import {
  INVENTORY_CARD_FIELD_IDS,
  OPTIONAL_INVENTORY_CARD_FIELDS,
  REQUIRED_INVENTORY_CARD_FIELDS,
  type InventoryCardFieldId,
  type OptionalInventoryCardFieldId,
} from "./types"

/**
 * Optional fields that must reappear during inline edit even if listed in
 * hiddenFields, so values remain maintainable. Non-editable optionals
 * (totalValue, status, createdAt, usageHistory, photos) stay hidden while editing.
 */
export const EDITABLE_OPTIONAL_FIELDS_WHILE_EDITING = [
  "badges",
  "unitCost",
  "location",
  "dimensions",
  "notes",
] as const satisfies readonly OptionalInventoryCardFieldId[]

/**
 * Compact category-grid cards only support this subset.
 * Full field reordering applies to detailed InventoryItemDetail cards;
 * compact cards use this subset with relative order from fieldOrder.
 */
export const COMPACT_CARD_FIELD_IDS = [
  "holdStatus",
  "productName",
  "photos",
  "badges",
  "quantity",
  "unitCost",
  "status",
  "dimensions",
] as const satisfies readonly InventoryCardFieldId[]

export type CompactCardFieldId = (typeof COMPACT_CARD_FIELD_IDS)[number]

const KNOWN_FIELD_SET = new Set<string>(INVENTORY_CARD_FIELD_IDS)
const REQUIRED_FIELD_SET = new Set<string>(REQUIRED_INVENTORY_CARD_FIELDS)
const OPTIONAL_FIELD_SET = new Set<string>(OPTIONAL_INVENTORY_CARD_FIELDS)
const EDITABLE_WHILE_EDITING_SET = new Set<string>(EDITABLE_OPTIONAL_FIELDS_WHILE_EDITING)
const COMPACT_FIELD_SET = new Set<string>(COMPACT_CARD_FIELD_IDS)

export function isInventoryCardFieldId(value: string): value is InventoryCardFieldId {
  return KNOWN_FIELD_SET.has(value)
}

export function isRequiredInventoryCardField(id: InventoryCardFieldId): boolean {
  return REQUIRED_FIELD_SET.has(id)
}

export function isCompactCardFieldId(id: InventoryCardFieldId): id is CompactCardFieldId {
  return COMPACT_FIELD_SET.has(id)
}

export type ResolveInventoryFieldsOptions = {
  fieldOrder: readonly string[]
  hiddenFields: readonly string[]
  isEditing: boolean
  /** detail = full InventoryItemDetail; compact = category grid subset */
  mode: "detail" | "compact"
}

function isHiddenOptional(
  id: InventoryCardFieldId,
  hiddenSet: Set<string>,
  isEditing: boolean,
): boolean {
  if (REQUIRED_FIELD_SET.has(id)) return false
  if (!hiddenSet.has(id)) return false
  if (isEditing && EDITABLE_WHILE_EDITING_SET.has(id)) return false
  return true
}

/**
 * Pure resolver for visible inventory card fields.
 * - Dedupes IDs and drops unknown IDs
 * - Never hides required fields
 * - Re-shows editable optionals while editing
 * - Injects any missing required fields at the front (required order)
 * Does not mutate the input arrays.
 */
export function resolveVisibleInventoryFields(
  options: ResolveInventoryFieldsOptions,
): InventoryCardFieldId[] {
  const hiddenSet = new Set(
    options.hiddenFields.filter((id): id is OptionalInventoryCardFieldId =>
      OPTIONAL_FIELD_SET.has(id),
    ),
  )

  const seen = new Set<InventoryCardFieldId>()
  const ordered: InventoryCardFieldId[] = []

  for (const raw of options.fieldOrder) {
    if (!isInventoryCardFieldId(raw)) continue
    if (seen.has(raw)) continue
    if (options.mode === "compact" && !isCompactCardFieldId(raw)) continue
    if (isHiddenOptional(raw, hiddenSet, options.isEditing)) continue
    seen.add(raw)
    ordered.push(raw)
  }

  const missingRequired = REQUIRED_INVENTORY_CARD_FIELDS.filter((id) => {
    if (options.mode === "compact" && !isCompactCardFieldId(id)) return false
    return !seen.has(id)
  })

  return [...missingRequired, ...ordered]
}

/** Whether an optional field is configured as hidden (ignoring edit override). */
export function isFieldConfiguredHidden(
  id: InventoryCardFieldId,
  hiddenFields: readonly string[],
): boolean {
  if (REQUIRED_FIELD_SET.has(id)) return false
  return hiddenFields.includes(id)
}
