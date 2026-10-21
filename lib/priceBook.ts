export const ENTRY_TYPES = ["material", "demolition", "installation"] as const
export const MATERIAL_UNITS = ["sq_ft", "linear_ft", "each", "box"] as const
export const LABOR_UNITS = ["sq_ft", "flat"] as const
export const COVERAGE_UNITS = ["sq_ft", "linear_ft", "each"] as const

export type EntryType = (typeof ENTRY_TYPES)[number]
export type MaterialUnit = (typeof MATERIAL_UNITS)[number]
export type LaborUnit = (typeof LABOR_UNITS)[number]
export type MarginMode = "company" | "override"

const UNIT_LABELS: Record<string, string> = {
  sq_ft: "sq ft",
  linear_ft: "linear ft",
  each: "each",
  box: "box",
  flat: "flat",
}

const UNIT_PHRASES: Record<string, string> = {
  sq_ft: "per square foot",
  linear_ft: "per linear foot",
  each: "per each",
  box: "per box",
  flat: "as a flat amount",
}

const DECIMAL = /^\d+(\.\d+)?$/

export type PriceBookEntry = {
  id: string
  entry_type: EntryType
  name: string
  category: string | null
  description: string | null
  status: "active" | "archived"
  pricing_unit: string
  price_basis: string | null
  price_conversion_confirmed: boolean
  coverage_quantity: string | null
  coverage_unit: string | null
  supplier_id: string | null
  purchase_cost: string | null
  gross_margin_percent_override: string | null
  cost_source: string | null
  cost_effective_on: string | null
  labor_selling_rate: string | null
}

export type SupplierIdentifier = {
  id: string
  entry_id: string
  supplier_id: string
  kind: "supplier_sku" | "internal"
  code: string
}

export type PriceBookSupplier = {
  id: string
  name: string
  notes: string | null
  status: "active" | "archived"
}

export type EntryDraft = {
  entryType: EntryType
  name: string
  category: string
  description: string
  supplierId: string
  pricingUnit: string
  priceBasis: string
  conversionConfirmed: boolean
  coverageQuantity: string
  coverageUnit: string
  purchaseCost: string
  marginMode: MarginMode
  marginOverride: string
  costEffectiveOn: string
  laborRate: string
  replacementSku: string
  replacementInternal: string
  newSku: string
  newInternal: string
}

export function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value)
}

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return "—"
  return UNIT_LABELS[unit] ?? unit
}

export function entryTypeLabel(type: string): string {
  switch (type) {
    case "material":
      return "Material"
    case "demolition":
      return "Demolition"
    case "installation":
      return "Installation"
    default:
      return type
  }
}

export function identifierKindLabel(kind: string): string {
  return kind === "internal" ? "Internal identifier" : "Supplier SKU"
}

export function costSourceLabel(source: string | null | undefined): string {
  if (source === "pdf_import") return "PDF import"
  if (source === "manual") return "Manual"
  return "—"
}

export function todayInputValue(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function emptyEntryDraft(): EntryDraft {
  return {
    entryType: "material",
    name: "",
    category: "",
    description: "",
    supplierId: "",
    pricingUnit: "sq_ft",
    priceBasis: "sq_ft",
    conversionConfirmed: false,
    coverageQuantity: "",
    coverageUnit: "",
    purchaseCost: "",
    marginMode: "company",
    marginOverride: "",
    costEffectiveOn: todayInputValue(),
    laborRate: "",
    replacementSku: "",
    replacementInternal: "",
    newSku: "",
    newInternal: "",
  }
}

export function draftFromEntry(entry: PriceBookEntry): EntryDraft {
  return {
    ...emptyEntryDraft(),
    entryType: entry.entry_type,
    name: entry.name,
    category: entry.category ?? "",
    description: entry.description ?? "",
    supplierId: entry.supplier_id ?? "",
    pricingUnit: entry.pricing_unit,
    priceBasis: entry.price_basis ?? "",
    conversionConfirmed: entry.price_conversion_confirmed,
    coverageQuantity: entry.coverage_quantity ?? "",
    coverageUnit: entry.coverage_unit ?? "",
    purchaseCost: entry.purchase_cost ?? "",
    marginMode: entry.gross_margin_percent_override == null ? "company" : "override",
    marginOverride: entry.gross_margin_percent_override ?? "",
    costEffectiveOn: entry.cost_effective_on ?? "",
    laborRate: entry.labor_selling_rate ?? "",
    newSku: "",
    newInternal: "",
  }
}

export function readableMoney(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—"
  const trimmed = value.trim()
  if (!DECIMAL.test(trimmed)) return trimmed
  const [wholeRaw, fraction = ""] = trimmed.split(".")
  const whole = wholeRaw.replace(/^0+(?=\d)/, "")
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const significant = fraction.replace(/0+$/, "")
  const shown = significant.length >= 2 ? significant.slice(0, 6) : (fraction + "00").slice(0, 2)
  return `$${withCommas}.${shown.padEnd(2, "0")}`
}

/** Two-decimal display for a decimal string. Does not turn the stored value into a number. */
export function readableMoneyCents(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—"
  const rounded = roundDecimalHalfAway(value.trim(), 2)
  if (!rounded) return "—"
  return readableMoney(rounded)
}

function roundDecimalHalfAway(value: string, places: number): string | null {
  if (!DECIMAL.test(value)) return null
  const [wholeRaw, fraction = ""] = value.split(".")
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0"
  if (fraction.length <= places) {
    return `${whole}.${(fraction + "0".repeat(places)).slice(0, places)}`
  }
  const keep = fraction.slice(0, places).split("")
  const next = fraction[places] ?? "0"
  if (next < "5") return `${whole}.${keep.join("")}`
  let carry = 1
  for (let index = keep.length - 1; index >= 0; index -= 1) {
    const digit = keep[index].charCodeAt(0) - 48 + carry
    if (digit >= 10) {
      keep[index] = "0"
      carry = 1
    } else {
      keep[index] = String.fromCharCode(48 + digit)
      carry = 0
      break
    }
  }
  const wholeDigits = whole.split("")
  for (let index = wholeDigits.length - 1; carry && index >= 0; index -= 1) {
    const digit = wholeDigits[index].charCodeAt(0) - 48 + carry
    if (digit >= 10) {
      wholeDigits[index] = "0"
      carry = 1
    } else {
      wholeDigits[index] = String.fromCharCode(48 + digit)
      carry = 0
    }
  }
  if (carry) wholeDigits.unshift("1")
  return `${wholeDigits.join("")}.${keep.join("")}`
}

export function readablePercent(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—"
  const trimmed = value.trim()
  if (!DECIMAL.test(trimmed)) return trimmed
  const [wholeRaw, fraction = ""] = trimmed.split(".")
  const whole = wholeRaw.replace(/^0+(?=\d)/, "")
  const shown = fraction.replace(/0+$/, "").slice(0, 2)
  return shown ? `${whole}.${shown}%` : `${whole}%`
}

export function readableDecimal(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—"
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
  const negative = trimmed.startsWith("-")
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [wholeRaw, fraction = ""] = unsigned.split(".")
  const whole = wholeRaw.replace(/^0+(?=\d)/, "")
  const shown = fraction.replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${shown ? `.${shown}` : ""}`
}

export function priceBookErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The price book request failed."
  const tagged = raw.match(/PRICEBOOK:[A-Z0-9_]+:([\s\S]*)$/)
  if (tagged?.[1]) return tagged[1].trim()
  if (/price_book_supplier_identifiers_code_uidx/i.test(raw)) {
    return "That identifier is already used for this supplier."
  }
  if (/price_book_suppliers_name_uidx/i.test(raw)) {
    return "A supplier with that name already exists."
  }
  if (/price_book_entry_inventory_items_item_uidx/i.test(raw)) {
    return "That inventory record is already linked to a material."
  }
  if (missingPurchaseTaxColumn(error)) {
    return "Material purchase tax is not in the database yet. Selling prices do not include purchase tax until that update is applied."
  }
  if (missingMaterialCalculation(error)) return MATERIAL_CALCULATION_UNAVAILABLE
  if (/does not exist|schema cache|PGRST205/i.test(raw)) {
    return "The price book is not available yet. Try again after the database update is in place."
  }
  if (
    /permission denied for function price_book_(validate_purchase_tax|company_default_purchase_tax|entry_unit_selling_price|entry_audit_json|estimate_material_snapshot|entry_material_calculation|material_price_snapshot|material_unit_selling_price|material_line_total|material_pretax_cost_per_pricing_unit|material_price_parts)/i.test(
      raw,
    )
  ) {
    return "The selling price could not be read."
  }
  if (/permission denied/i.test(raw)) return "You do not have access to the price book."
  if (/JWT expired|invalid claim|not authenticated/i.test(raw)) return "Sign in again to use the price book."
  return raw.trim() || "The price book request failed."
}

export function derivedCoverageUnit(pricingUnit: string, priceBasis: string): string | null {
  if (priceBasis === "box" && pricingUnit !== "box" && pricingUnit !== "flat") return pricingUnit
  if (pricingUnit === "box" && priceBasis !== "box" && priceBasis !== "") return priceBasis
  return null
}

export type ConversionCase = "same" | "needs-confirmation" | "invalid"

export function conversionCase(pricingUnit: string, priceBasis: string): ConversionCase {
  if (!pricingUnit || !priceBasis || pricingUnit === priceBasis) return "same"
  if (
    (priceBasis === "box" && pricingUnit !== "box") ||
    (pricingUnit === "box" && priceBasis !== "box")
  ) {
    return "needs-confirmation"
  }
  return "invalid"
}

export function conversionExplanation(pricingUnit: string, priceBasis: string): string | null {
  const kind = conversionCase(pricingUnit, priceBasis)
  if (kind === "same") {
    if (pricingUnit === "box") {
      return "Optional box coverage records how much of another unit is in one box. Leave both coverage fields blank if you are not recording it."
    }
    return null
  }
  if (kind === "invalid") {
    return "Confirmed conversion is only supported between a box and the coverage unit."
  }
  const purchased = UNIT_PHRASES[priceBasis] ?? priceBasis
  const sold = UNIT_PHRASES[pricingUnit] ?? pricingUnit
  const coverage = unitLabel(derivedCoverageUnit(pricingUnit, priceBasis))
  return `The purchase cost is ${purchased}, and the selling unit is ${sold}. Enter how many ${coverage} are in one box, then confirm the conversion. A per-box price cannot be applied to another unit without that confirmation.`
}

function lengthError(value: string, max: number, label: string): string | null {
  if (value.length > max) return `${label} must be ${max} characters or less.`
  return null
}

function decimalError(value: string, scale: number, label: string, allowZero: boolean): string | null {
  const trimmed = value.trim()
  if (!trimmed) return `Enter ${label}.`
  if (trimmed.startsWith("-")) return `${label} cannot be negative.`
  if (!DECIMAL.test(trimmed)) return `${label} must be a decimal number.`
  const [wholeRaw, fraction = ""] = trimmed.split(".")
  if (fraction.length > scale) return `${label} supports at most ${scale} decimal places.`
  const whole = wholeRaw.replace(/^0+(?=\d)/, "")
  if (whole.length > 8) return `${label} is too large.`
  if (!allowZero && !/[1-9]/.test(trimmed)) return `${label} must be greater than zero.`
  return null
}

function marginValueError(value: string): string | null {
  const scaleError = decimalError(value, 2, "Gross margin", true)
  if (scaleError) return scaleError
  const whole = value.trim().split(".")[0].replace(/^0+(?=\d)/, "")
  if (whole.length > 2) return "Gross margin must be at least 0 and less than 100."
  return null
}

export function validateMarginInput(value: string): string | null {
  return marginValueError(value)
}

export function missingPurchaseTaxColumn(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : ""
  return /default_material_purchase_tax_percent/i.test(raw) && /does not exist|schema cache|PGRST204|42703/i.test(raw)
}

export const PURCHASE_TAX_UNAVAILABLE =
  "Material purchase tax is not in the database yet. Selling prices do not include purchase tax until that update is applied."

function purchaseTaxValueError(value: string): string | null {
  const scaleError = decimalError(value, 2, "Material purchase tax", true)
  if (scaleError) return scaleError
  const whole = value.trim().split(".")[0].replace(/^0+(?=\d)/, "")
  if (whole.length > 3) return "Material purchase tax must be at least 0 and at most 999.99."
  return null
}

export function validatePurchaseTaxInput(value: string): string | null {
  return purchaseTaxValueError(value)
}

export const MATERIAL_CALCULATION_UNAVAILABLE =
  "Calculation details are not available yet. The selling price is still shown."

export function missingMaterialCalculation(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : ""
  return /price_book_entry_material_calculation/i.test(raw) && /does not exist|schema cache|PGRST202|42883/i.test(raw)
}

export function validateSampleQuantity(value: string, flat: boolean): string | null {
  if (flat && value.trim() !== "1") return "Flat labor is one charge. Quantity must be 1."
  return decimalError(value, 4, "Quantity", true)
}

export function validateEntryDraft(draft: EntryDraft, isCreate: boolean, savedSupplierId: string | null): string | null {
  const name = draft.name.trim()
  if (!name) return "Enter a name."
  const nameError = lengthError(name, 200, "Name")
  if (nameError) return nameError
  const categoryError = lengthError(draft.category.trim(), 80, "Category")
  if (categoryError) return categoryError
  const descriptionError = lengthError(draft.description.trim(), 4000, "Description")
  if (descriptionError) return descriptionError

  if (draft.entryType === "material") {
    if (!(MATERIAL_UNITS as readonly string[]).includes(draft.pricingUnit)) {
      return "Pricing unit must be square foot, linear foot, each, or box."
    }
    if (!(MATERIAL_UNITS as readonly string[]).includes(draft.priceBasis)) {
      return "Price basis must be square foot, linear foot, each, or box."
    }
    const costError = decimalError(draft.purchaseCost, 4, "Purchase cost excluding purchase tax", true)
    if (costError) return costError
    if (draft.marginMode === "override") {
      const marginError = marginValueError(draft.marginOverride)
      if (marginError) return marginError
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.costEffectiveOn)) {
      return "Material cost needs an effective date."
    }

    const units = conversionCase(draft.pricingUnit, draft.priceBasis)
    if (units === "invalid") {
      return "Confirmed conversion is only supported between a box and the coverage unit."
    }
    if (units === "needs-confirmation") {
      if (!draft.conversionConfirmed) {
        return "A different price basis and pricing unit need a confirmed coverage conversion. A per-box price cannot be applied to another unit without that confirmation."
      }
      const coverageError = decimalError(draft.coverageQuantity, 4, "Coverage quantity", false)
      if (coverageError) return coverageError
    } else if (draft.pricingUnit === "box" && (draft.coverageQuantity.trim() || draft.coverageUnit)) {
      const coverageError = decimalError(draft.coverageQuantity, 4, "Coverage quantity", false)
      if (coverageError) return coverageError
      if (!(COVERAGE_UNITS as readonly string[]).includes(draft.coverageUnit)) {
        return "Coverage unit must be square foot, linear foot, or each."
      }
    }

    const supplierChanged = !isCreate && (savedSupplierId ?? "") !== draft.supplierId
    if (supplierChanged && savedSupplierId && !draft.supplierId) {
      return "A supplier-backed material keeps its supplier. Archive it and create a new material to sell it without a supplier."
    }
    if ((isCreate && draft.supplierId) || supplierChanged) {
      const sku = draft.newSku.trim()
      const internal = draft.newInternal.trim()
      if (!sku && !internal) {
        return supplierChanged
          ? "Enter a supplier SKU or an internal identifier for the new supplier. Codes from the previous supplier are not carried over."
          : "Assign a supplier SKU or an internal supplier-specific identifier before saving a material for that supplier."
      }
      if (sku.length > 80 || internal.length > 80) {
        return "Supplier identifiers must be 80 characters or less."
      }
    }
    return null
  }

  if (draft.supplierId) return "Demolition and installation entries do not use a supplier."
  if (!(LABOR_UNITS as readonly string[]).includes(draft.pricingUnit)) {
    return "Labor pricing unit must be square foot or flat."
  }
  return decimalError(draft.laborRate, 4, "Selling rate", true)
}

export function sameNumericText(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left == null || right == null) return left == null && right == null
  if (!DECIMAL.test(left.trim()) || !DECIMAL.test(right.trim())) return false
  const normalize = (value: string) => {
    const [wholeRaw, fraction = ""] = value.trim().split(".")
    return `${wholeRaw.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`
  }
  return normalize(left) === normalize(right)
}

export function auditActionLabel(action: string): string {
  switch (action) {
    case "create":
      return "Created"
    case "update":
      return "Updated"
    case "archive":
      return "Archived"
    case "restore":
      return "Restored"
    case "identifier_create":
      return "Identifier added"
    case "identifier_update":
      return "Identifier updated"
    case "identifier_delete":
      return "Identifier removed"
    case "link_inventory":
      return "Inventory linked"
    case "unlink_inventory":
      return "Inventory unlinked"
    default:
      return action
  }
}

export const AUDIT_MONEY_KEYS = [
  "purchase_cost",
  "pretax_cost_per_pricing_unit",
  "tax_inclusive_cost_per_pricing_unit",
  "labor_selling_rate",
  "gross_margin_percent_override",
  "company_default_gross_margin_percent",
  "effective_gross_margin_percent",
  "unit_selling_price",
  "default_material_gross_margin_percent",
  "purchase_tax_percent",
  "company_default_purchase_tax_percent",
  "default_material_purchase_tax_percent",
] as const

export const AUDIT_MARGIN_KEYS = new Set([
  "gross_margin_percent_override",
  "company_default_gross_margin_percent",
  "effective_gross_margin_percent",
  "default_material_gross_margin_percent",
  "purchase_tax_percent",
  "company_default_purchase_tax_percent",
  "default_material_purchase_tax_percent",
])

export const AUDIT_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "entry_type", label: "Type" },
  { key: "category", label: "Category" },
  { key: "description", label: "Description" },
  { key: "status", label: "Status" },
  { key: "pricing_unit", label: "Pricing unit" },
  { key: "price_basis", label: "Price basis" },
  { key: "price_conversion_confirmed", label: "Conversion confirmed" },
  { key: "coverage_quantity", label: "Coverage quantity" },
  { key: "coverage_unit", label: "Coverage unit" },
  { key: "supplier_id", label: "Supplier" },
  { key: "purchase_cost", label: "Purchase cost excluding purchase tax" },
  { key: "pretax_cost_per_pricing_unit", label: "Pretax cost per pricing unit" },
  { key: "purchase_tax_percent", label: "Material purchase tax" },
  { key: "company_default_purchase_tax_percent", label: "Company material purchase tax" },
  { key: "default_material_purchase_tax_percent", label: "Company material purchase tax" },
  { key: "tax_inclusive_cost_per_pricing_unit", label: "Tax-inclusive cost per pricing unit" },
  { key: "gross_margin_percent_override", label: "Item margin" },
  { key: "company_default_gross_margin_percent", label: "Company default margin" },
  { key: "effective_gross_margin_percent", label: "Effective margin" },
  { key: "unit_selling_price", label: "Unit selling price" },
  { key: "default_material_gross_margin_percent", label: "Company default margin" },
  { key: "cost_source", label: "Cost source" },
  { key: "cost_effective_on", label: "Cost effective date" },
  { key: "labor_selling_rate", label: "Selling rate" },
  { key: "kind", label: "Identifier" },
  { key: "code", label: "Code" },
]

const JSON_VALUE = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/

export function readJsonTextField(json: string, key: string): string | null | undefined {
  const match = json.match(new RegExp(`"${key}"\\s*:\\s*(${JSON_VALUE.source})`))
  if (!match?.[1]) return undefined
  const raw = match[1]
  if (raw === "null") return null
  if (raw === "true" || raw === "false") return raw
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === "string" ? parsed : raw
    } catch {
      return raw
    }
  }
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return undefined
  return raw
}

export const PRICE_BOOK_DISPLAY_PAGE_SIZE = 40

export type PriceBookListFilters = {
  search: string
  entryType: string
  category: string
  supplierId: string
  status: string
}

export function filterPriceBookEntries(
  entries: PriceBookEntry[],
  identifiers: SupplierIdentifier[],
  filters: PriceBookListFilters,
): PriceBookEntry[] {
  const query = filters.search.trim().toLowerCase()
  const codesByEntry = new Map<string, string[]>()
  for (const identifier of identifiers) {
    const codes = codesByEntry.get(identifier.entry_id) ?? []
    codes.push(identifier.code.toLowerCase())
    codesByEntry.set(identifier.entry_id, codes)
  }
  return entries.filter((entry) => {
    if (filters.entryType !== "all" && entry.entry_type !== filters.entryType) return false
    if (filters.status !== "all" && entry.status !== filters.status) return false
    if (filters.category === "none" && entry.category) return false
    if (filters.category !== "all" && filters.category !== "none" && entry.category !== filters.category) return false
    if (filters.supplierId === "none" && entry.supplier_id) return false
    if (filters.supplierId !== "all" && filters.supplierId !== "none" && entry.supplier_id !== filters.supplierId) {
      return false
    }
    if (!query) return true
    if (entry.name.toLowerCase().includes(query)) return true
    return (codesByEntry.get(entry.id) ?? []).some((code) => code.includes(query))
  })
}

export function pagePriceBookEntries<T>(items: T[], pageIndex: number, pageSize: number) {
  const pageCount = items.length === 0 ? 1 : Math.ceil(items.length / pageSize)
  const safeIndex = Math.min(Math.max(0, pageIndex), pageCount - 1)
  const start = safeIndex * pageSize
  return {
    items: items.slice(start, start + pageSize),
    pageIndex: safeIndex,
    pageCount,
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, items.length),
    total: items.length,
  }
}

export function materialsForSellingPrices(entries: PriceBookEntry[]): PriceBookEntry[] {
  return entries.filter((entry) => entry.entry_type === "material")
}

export function redactAuditMoney(json: string | null): string | null {
  if (!json) return null
  const pattern = new RegExp(
    `"(${AUDIT_MONEY_KEYS.join("|")})"\\s*:\\s*(?:${JSON_VALUE.source})`,
    "g",
  )
  return json.replace(pattern, '"$1":null')
}
