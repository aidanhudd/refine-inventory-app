import { supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient"
import {
  derivedCoverageUnit,
  isEntryType,
  missingPurchaseTaxColumn,
  redactAuditMoney,
  sameNumericText,
  type EntryDraft,
  type EntryType,
  type PriceBookEntry,
  type PriceBookSupplier,
  type SupplierIdentifier,
} from "./priceBook"

export type AccountSession = {
  userId: string
  accessToken: string
}

export type PriceBookCatalog = {
  entries: PriceBookEntry[]
  identifiers: SupplierIdentifier[]
  suppliers: PriceBookSupplier[]
  companyMargin: string | null
  companyPurchaseTax: string | null
  purchaseTaxAvailable: boolean
  settingsPresent: boolean
}

export type InventoryMatch = {
  id: string
  sku: string | null
  product_name: string | null
  quantity_on_hand: string | null
  unit_cost: string | null
}

export type AuditEvent = {
  id: string
  occurred_at: string
  action: string
  table_name: string
  inventory_item_id: string | null
  before_data: string | null
  after_data: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function readAccountSession(): Promise<AccountSession | null> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session?.user?.id || !session.access_token) return null
  return { userId: session.user.id, accessToken: session.access_token }
}

export async function accountStill(userId: string): Promise<boolean> {
  const current = await readAccountSession()
  return current?.userId === userId
}

function authHeaders(session: AccountSession, jsonBody: boolean): HeadersInit {
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    Accept: "application/json",
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  }
}

function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("Price book id was not valid.")
  return value
}

function messageFromBody(text: string, status: number): string {
  if (!text) return status === 401 ? "Sign in again to use the price book." : "The price book request failed."
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; hint?: unknown }
    const message = typeof parsed.message === "string" ? parsed.message : ""
    const hint = typeof parsed.hint === "string" ? parsed.hint : ""
    const error = typeof parsed.error === "string" ? parsed.error : ""
    return message || hint || error || text
  } catch {
    return text
  }
}

async function requestText(
  session: AccountSession,
  pathAndQuery: string,
  init?: { method?: string; body?: string },
): Promise<string> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: authHeaders(session, init?.body != null),
    body: init?.body,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(messageFromBody(text, response.status))
  return text
}

function parseJson(text: string): unknown {
  if (!text) return null
  return JSON.parse(text) as unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("The price book returned an unexpected list.")
  return value.map((row) => {
    const record = asRecord(row)
    if (!record) throw new Error("The price book returned an unexpected row.")
    return record
  })
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || !value) throw new Error("The price book returned an incomplete row.")
  return value
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value == null) return null
  if (typeof value !== "string") throw new Error("The price book returned an unexpected value.")
  return value
}

function decimalText(row: Record<string, unknown>, key: string, present: boolean): string | null {
  if (!present) return null
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    throw new Error("A price book amount was not returned as a decimal.")
  }
  const value = row[key]
  if (value == null) return null
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("A price book amount was not returned as a decimal.")
  }
  return value
}

function quantityText(row: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    throw new Error("Inventory quantity was not returned as a decimal.")
  }
  const value = row[key]
  if (value == null) return null
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error("Inventory quantity was not returned as a decimal.")
  }
  return value
}

async function readRows(
  session: AccountSession,
  pathAndQuery: string,
): Promise<Record<string, unknown>[]> {
  return asRows(parseJson(await requestText(session, pathAndQuery)))
}

/** Rows requested per catalog request. The server may return fewer; paging follows Content-Range. */
export const PRICE_BOOK_FETCH_PAGE_SIZE = 200

export type PriceBookContentRange = {
  start: number | null
  end: number | null
  total: number | null
}

export function parseContentRange(header: string | null): PriceBookContentRange {
  if (!header) return { start: null, end: null, total: null }
  const match = /^(?:\*|(\d+)-(\d+))\/(\*|\d+)$/.exec(header.trim())
  if (!match) return { start: null, end: null, total: null }
  return {
    start: match[1] == null ? null : Number(match[1]),
    end: match[2] == null ? null : Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  }
}

const INCOMPLETE_PAGE = "The price book did not confirm that every row was received."

export async function collectPagedRows<T>(
  pageSize: number,
  readPage: (from: number, to: number) => Promise<{ rows: T[]; contentRange: string | null; status: number }>,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("The price book page size is invalid.")
  }
  const collected: T[] = []
  let from = 0
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const page = await readPage(from, from + pageSize - 1)
    if (page.status === 416) {
      const range = parseContentRange(page.contentRange)
      if (range.total == null || collected.length !== range.total) throw new Error(INCOMPLETE_PAGE)
      return collected
    }
    if (page.status !== 200 && page.status !== 206) {
      throw new Error(page.rows.length ? INCOMPLETE_PAGE : "The price book request failed.")
    }
    const range = parseContentRange(page.contentRange)
    if (range.total == null) throw new Error(INCOMPLETE_PAGE)
    if (range.total === 0) {
      if (page.rows.length !== 0 || collected.length !== 0) throw new Error(INCOMPLETE_PAGE)
      return []
    }
    if (range.start == null || range.end == null) throw new Error(INCOMPLETE_PAGE)
    if (range.start !== from) throw new Error(INCOMPLETE_PAGE)
    if (page.rows.length !== range.end - range.start + 1) throw new Error(INCOMPLETE_PAGE)
    collected.push(...page.rows)
    if (collected.length === range.total) return collected
    if (collected.length > range.total) throw new Error(INCOMPLETE_PAGE)
    const nextFrom = range.end + 1
    if (nextFrom <= from) throw new Error(INCOMPLETE_PAGE)
    from = nextFrom
  }
  throw new Error(INCOMPLETE_PAGE)
}

async function readAllRows(
  session: AccountSession,
  path: string,
  params: Record<string, string>,
  order: string,
): Promise<Record<string, unknown>[]> {
  const rows = await collectPagedRows(PRICE_BOOK_FETCH_PAGE_SIZE, async (from, to) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${query(path, { ...params, order })}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        ...authHeaders(session, false),
        Range: `${from}-${to}`,
        "Range-Unit": "items",
        Prefer: "count=exact",
      },
    })
    const text = await response.text()
    if (response.status !== 200 && response.status !== 206 && response.status !== 416) {
      throw new Error(messageFromBody(text, response.status))
    }
    return {
      rows: response.status === 416 ? [] : asRows(parseJson(text)),
      contentRange: response.headers.get("content-range"),
      status: response.status,
    }
  })
  const ids = new Set<string>()
  for (const row of rows) {
    const id = row.id
    if (typeof id !== "string" || !id || ids.has(id)) throw new Error(INCOMPLETE_PAGE)
    ids.add(id)
  }
  return rows
}

function query(path: string, params: Record<string, string>): string {
  const search = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
  return `${path}?${search}`
}

function entrySelect(includeMoney: boolean): string {
  const money = includeMoney
    ? ",purchase_cost::text,gross_margin_percent_override::text,labor_selling_rate::text"
    : ""
  return `id,entry_type,name,category,description,status,pricing_unit,price_basis,price_conversion_confirmed,coverage_quantity::text,coverage_unit,supplier_id,cost_source,cost_effective_on${money}`
}

function parseEntry(row: Record<string, unknown>, includeMoney: boolean): PriceBookEntry {
  const entryType = requiredString(row, "entry_type")
  const status = requiredString(row, "status")
  if (!isEntryType(entryType) || (status !== "active" && status !== "archived")) {
    throw new Error("The price book returned an entry the screen cannot show.")
  }
  const confirmed = row.price_conversion_confirmed
  if (typeof confirmed !== "boolean") throw new Error("The price book returned an unexpected value.")
  return {
    id: requiredString(row, "id"),
    entry_type: entryType,
    name: requiredString(row, "name"),
    category: optionalString(row, "category"),
    description: optionalString(row, "description"),
    status,
    pricing_unit: requiredString(row, "pricing_unit"),
    price_basis: optionalString(row, "price_basis"),
    price_conversion_confirmed: confirmed,
    coverage_quantity: decimalText(row, "coverage_quantity", true),
    coverage_unit: optionalString(row, "coverage_unit"),
    supplier_id: optionalString(row, "supplier_id"),
    purchase_cost: decimalText(row, "purchase_cost", includeMoney),
    gross_margin_percent_override: decimalText(row, "gross_margin_percent_override", includeMoney),
    cost_source: optionalString(row, "cost_source"),
    cost_effective_on: optionalString(row, "cost_effective_on")?.slice(0, 10) ?? null,
    labor_selling_rate: decimalText(row, "labor_selling_rate", includeMoney),
  }
}

function parseIdentifier(row: Record<string, unknown>): SupplierIdentifier {
  const kind = requiredString(row, "kind")
  if (kind !== "supplier_sku" && kind !== "internal") {
    throw new Error("The price book returned an identifier the screen cannot show.")
  }
  return {
    id: requiredString(row, "id"),
    entry_id: requiredString(row, "entry_id"),
    supplier_id: requiredString(row, "supplier_id"),
    kind,
    code: requiredString(row, "code"),
  }
}

function parseSupplier(row: Record<string, unknown>): PriceBookSupplier {
  const status = requiredString(row, "status")
  if (status !== "active" && status !== "archived") {
    throw new Error("The price book returned a supplier the screen cannot show.")
  }
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    notes: optionalString(row, "notes"),
    status,
  }
}

export function stripCatalogMoney(catalog: PriceBookCatalog): PriceBookCatalog {
  return {
    ...catalog,
    companyMargin: null,
    companyPurchaseTax: null,
    entries: catalog.entries.map((entry) => ({
      ...entry,
      purchase_cost: null,
      gross_margin_percent_override: null,
      labor_selling_rate: null,
    })),
  }
}

async function readCompanyPurchaseTax(
  session: AccountSession,
  includeMoney: boolean,
): Promise<{ available: boolean; tax: string | null }> {
  try {
    const rows = await readRows(
      session,
      query("price_book_settings", {
        select: "default_material_purchase_tax_percent::text",
        id: "eq.1",
        ...(includeMoney ? {} : { limit: "0" }),
      }),
    )
    if (!includeMoney) return { available: true, tax: null }
    const settings = rows[0]
    if (!settings) return { available: true, tax: null }
    const tax = decimalText(settings, "default_material_purchase_tax_percent", true)
    if (tax == null) throw new Error("Material purchase tax was not returned as a decimal.")
    return { available: true, tax }
  } catch (error) {
    if (missingPurchaseTaxColumn(error)) return { available: false, tax: null }
    throw error
  }
}

export async function loadPriceBook(session: AccountSession, includeMoney: boolean): Promise<PriceBookCatalog> {
  const [entryRows, identifierRows, supplierRows, settingRows, purchaseTax] = await Promise.all([
    readAllRows(
      session,
      "price_book_entries",
      { select: entrySelect(includeMoney) },
      "name.asc,id.asc",
    ),
    readAllRows(
      session,
      "price_book_supplier_identifiers",
      { select: "id,entry_id,supplier_id,kind,code" },
      "entry_id.asc,id.asc",
    ),
    readAllRows(session, "price_book_suppliers", { select: "id,name,notes,status" }, "name.asc,id.asc"),
    readRows(
      session,
      query("price_book_settings", {
        select: includeMoney ? "default_material_gross_margin_percent::text" : "id",
        id: "eq.1",
      }),
    ),
    readCompanyPurchaseTax(session, includeMoney),
  ])

  const settings = settingRows[0]
  let companyMargin: string | null = null
  if (includeMoney && settings) {
    companyMargin = decimalText(settings, "default_material_gross_margin_percent", true)
  }

  return {
    entries: entryRows.map((row) => parseEntry(row, includeMoney)),
    identifiers: identifierRows.map(parseIdentifier),
    suppliers: supplierRows.map(parseSupplier),
    companyMargin,
    companyPurchaseTax: includeMoney ? purchaseTax.tax : null,
    purchaseTaxAvailable: purchaseTax.available,
    settingsPresent: settingRows.length > 0,
  }
}

function decimalFromRpcBody(text: string): string {
  const trimmed = text.trim()
  const bare = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
  if (!/^\d+(\.\d+)?$/.test(bare)) {
    throw new Error("The price book returned a price that was not a decimal.")
  }
  return bare
}

async function rpcText(session: AccountSession, fn: string, args: Record<string, unknown>): Promise<string> {
  return requestText(session, `rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  })
}

export async function materialUnitSellingPrice(session: AccountSession, entryId: string): Promise<string> {
  const text = await rpcText(session, "price_book_entry_unit_selling_price", {
    p_entry_id: assertUuid(entryId),
  })
  return decimalFromRpcBody(text)
}

export async function sampleMaterialLineTotal(
  session: AccountSession,
  quantity: string,
  unitPrice: string,
): Promise<string> {
  const text = await rpcText(session, "price_book_line_total", {
    p_quantity: quantity,
    p_unit_price: unitPrice,
  })
  return decimalFromRpcBody(text)
}

export async function sampleLaborLineTotal(
  session: AccountSession,
  pricingUnit: string,
  sellingRate: string,
  quantity: string,
): Promise<string> {
  const text = await rpcText(session, "price_book_labor_line_total", {
    p_pricing_unit: pricingUnit,
    p_selling_rate: sellingRate,
    p_quantity: quantity,
  })
  return decimalFromRpcBody(text)
}

function writeHeaders(session: AccountSession): HeadersInit {
  return {
    ...authHeaders(session, true),
    Prefer: "return=representation",
  }
}

async function mutate(
  session: AccountSession,
  method: "POST" | "PATCH" | "DELETE",
  pathAndQuery: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method,
    cache: "no-store",
    headers: body ? writeHeaders(session) : { ...authHeaders(session, false), Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(messageFromBody(text, response.status))
  if (!text) return []
  return asRows(parseJson(text))
}

function assertWrote(rows: Record<string, unknown>[], failure: string): void {
  if (rows.length === 0) throw new Error(failure)
}

const NO_CHANGE = "The price book did not change. Managers and admins can save these updates."

function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function materialMoney(draft: EntryDraft): {
  margin: string | null
  setMargin: boolean
  coverageQuantity: string | null
  coverageUnit: string | null
  confirmed: boolean
} {
  const unitsMatch = draft.pricingUnit === draft.priceBasis
  const coverageQuantity = blank(draft.coverageQuantity)
  const coverageUnit = unitsMatch
    ? draft.pricingUnit === "box" && coverageQuantity
      ? draft.coverageUnit
      : null
    : derivedCoverageUnit(draft.pricingUnit, draft.priceBasis)
  return {
    margin: draft.marginMode === "override" ? draft.marginOverride.trim() : null,
    setMargin: draft.marginMode === "override",
    coverageQuantity: coverageUnit ? coverageQuantity : null,
    coverageUnit: coverageUnit && coverageQuantity ? coverageUnit : null,
    confirmed: !unitsMatch && draft.conversionConfirmed,
  }
}

export async function saveSupplierMaterial(
  session: AccountSession,
  entryId: string | null,
  draft: EntryDraft,
  supplierChanged: boolean,
): Promise<void> {
  const money = materialMoney(draft)
  const creating = entryId == null
  const sendCodes = creating || supplierChanged
  const text = await rpcText(session, "price_book_save_supplier_material", {
    p_entry_id: entryId ? assertUuid(entryId) : null,
    p_name: draft.name.trim(),
    p_category: blank(draft.category),
    p_description: blank(draft.description),
    p_supplier_id: assertUuid(draft.supplierId),
    p_pricing_unit: draft.pricingUnit,
    p_price_basis: draft.priceBasis,
    p_price_conversion_confirmed: money.confirmed,
    p_coverage_quantity: money.coverageQuantity,
    p_coverage_unit: money.coverageUnit,
    p_purchase_cost: draft.purchaseCost.trim(),
    p_gross_margin_percent_override: money.margin,
    p_set_margin_override: creating ? money.setMargin : true,
    p_cost_effective_on: draft.costEffectiveOn,
    p_supplier_sku: sendCodes ? blank(draft.newSku) : null,
    p_internal_code: sendCodes ? blank(draft.newInternal) : null,
  })
  const id = text.trim().replace(/^"|"$/g, "")
  if (!UUID_PATTERN.test(id)) throw new Error("The price book did not confirm the saved material.")
}

export async function saveDirectEntry(
  session: AccountSession,
  entryId: string | null,
  draft: EntryDraft,
  previous: PriceBookEntry | null,
): Promise<void> {
  const creating = entryId == null
  let body: Record<string, unknown>
  if (draft.entryType !== "material") {
    body = {
      name: draft.name.trim(),
      category: blank(draft.category),
      description: blank(draft.description),
      pricing_unit: draft.pricingUnit,
      labor_selling_rate: draft.laborRate.trim(),
      price_conversion_confirmed: false,
      ...(creating
        ? { entry_type: draft.entryType satisfies EntryType, created_by: session.userId }
        : {
            price_basis: null,
            purchase_cost: null,
            gross_margin_percent_override: null,
            coverage_quantity: null,
            coverage_unit: null,
            supplier_id: null,
            cost_source: null,
            cost_effective_on: null,
          }),
    }
  } else {
    const money = materialMoney(draft)
    const costChanged = !sameNumericText(previous?.purchase_cost, draft.purchaseCost.trim())
    body = {
      name: draft.name.trim(),
      category: blank(draft.category),
      description: blank(draft.description),
      pricing_unit: draft.pricingUnit,
      price_basis: draft.priceBasis,
      price_conversion_confirmed: money.confirmed,
      coverage_quantity: money.coverageQuantity,
      coverage_unit: money.coverageUnit,
      purchase_cost: draft.purchaseCost.trim(),
      gross_margin_percent_override: money.margin,
      cost_effective_on: draft.costEffectiveOn,
      supplier_id: null,
      labor_selling_rate: null,
      ...(creating ? { entry_type: "material", created_by: session.userId } : {}),
      ...(!creating && costChanged ? { cost_source: "manual" } : {}),
    }
  }

  const rows = creating
    ? await mutate(session, "POST", query("price_book_entries", { select: "id" }), body)
    : await mutate(
        session,
        "PATCH",
        query("price_book_entries", { id: `eq.${assertUuid(entryId)}`, select: "id" }),
        body,
      )
  assertWrote(rows, NO_CHANGE)
}

export async function setEntryStatus(
  session: AccountSession,
  entryId: string,
  status: "active" | "archived",
): Promise<void> {
  const rows = await mutate(
    session,
    "PATCH",
    query("price_book_entries", { id: `eq.${assertUuid(entryId)}`, select: "id" }),
    { status },
  )
  assertWrote(rows, NO_CHANGE)
}

export async function saveSupplier(
  session: AccountSession,
  supplierId: string | null,
  name: string,
  notes: string,
): Promise<void> {
  const body: Record<string, unknown> = { name: name.trim(), notes: blank(notes) }
  const rows = supplierId
    ? await mutate(
        session,
        "PATCH",
        query("price_book_suppliers", { id: `eq.${assertUuid(supplierId)}`, select: "id" }),
        body,
      )
    : await mutate(session, "POST", query("price_book_suppliers", { select: "id" }), {
        ...body,
        created_by: session.userId,
      })
  assertWrote(rows, NO_CHANGE)
}

export async function setSupplierStatus(
  session: AccountSession,
  supplierId: string,
  status: "active" | "archived",
): Promise<void> {
  const rows = await mutate(
    session,
    "PATCH",
    query("price_book_suppliers", { id: `eq.${assertUuid(supplierId)}`, select: "id" }),
    { status },
  )
  assertWrote(rows, NO_CHANGE)
}

export async function saveCompanyMargin(session: AccountSession, margin: string): Promise<void> {
  const rows = await mutate(
    session,
    "PATCH",
    query("price_book_settings", { id: "eq.1", select: "id" }),
    { default_material_gross_margin_percent: margin.trim() },
  )
  assertWrote(rows, NO_CHANGE)
}

export async function saveCompanyPurchaseTax(session: AccountSession, purchaseTax: string): Promise<void> {
  const rows = await mutate(
    session,
    "PATCH",
    query("price_book_settings", { id: "eq.1", select: "id" }),
    { default_material_purchase_tax_percent: purchaseTax.trim() },
  )
  assertWrote(rows, NO_CHANGE)
}

export async function saveSupplierIdentifier(
  session: AccountSession,
  entryId: string,
  kind: "supplier_sku" | "internal",
  code: string,
): Promise<void> {
  const text = await rpcText(session, "price_book_save_supplier_identifier", {
    p_entry_id: assertUuid(entryId),
    p_kind: kind,
    p_code: code.trim(),
  })
  const id = text.trim().replace(/^"|"$/g, "")
  if (!UUID_PATTERN.test(id)) throw new Error("The price book did not confirm the identifier.")
}

export async function removeSupplierIdentifier(
  session: AccountSession,
  entryId: string,
  kind: "supplier_sku" | "internal",
): Promise<void> {
  await rpcText(session, "price_book_remove_supplier_identifier", {
    p_entry_id: assertUuid(entryId),
    p_kind: kind,
  })
}

export async function searchInventory(
  session: AccountSession,
  rawQuery: string,
): Promise<InventoryMatch[]> {
  const safe = rawQuery.replace(/[^a-zA-Z0-9 ._-]/g, " ").trim().replace(/\s+/g, " ")
  if (safe.length < 2) return []
  const rows = await readRows(
    session,
    query("inventory_items", {
      select: "id,sku,product_name,quantity_on_hand::text,unit_cost::text",
      or: `(product_name.ilike.*${safe}*,sku.ilike.*${safe}*)`,
      order: "product_name.asc",
      limit: "20",
    }),
  )
  return rows.map((row) => ({
    id: requiredString(row, "id"),
    sku: optionalString(row, "sku"),
    product_name: optionalString(row, "product_name"),
    quantity_on_hand: quantityText(row, "quantity_on_hand"),
    unit_cost: decimalText(row, "unit_cost", true),
  }))
}

export async function loadEntryLinks(session: AccountSession, entryId: string): Promise<InventoryMatch[]> {
  const links = await readRows(
    session,
    query("price_book_entry_inventory_items", {
      select: "inventory_item_id",
      entry_id: `eq.${assertUuid(entryId)}`,
    }),
  )
  const ids = links
    .map((row) => optionalString(row, "inventory_item_id"))
    .filter((id): id is string => !!id)
  if (ids.length === 0) return []
  const unique = [...new Set(ids)].map(assertUuid)
  const rows = await readRows(
    session,
    query("inventory_items", {
      select: "id,sku,product_name,quantity_on_hand::text,unit_cost::text",
      id: `in.(${unique.join(",")})`,
      order: "product_name.asc",
    }),
  )
  return rows.map((row) => ({
    id: requiredString(row, "id"),
    sku: optionalString(row, "sku"),
    product_name: optionalString(row, "product_name"),
    quantity_on_hand: quantityText(row, "quantity_on_hand"),
    unit_cost: decimalText(row, "unit_cost", true),
  }))
}

export async function linkInventoryItem(
  session: AccountSession,
  entryId: string,
  inventoryItemId: string,
): Promise<void> {
  const rows = await mutate(
    session,
    "POST",
    query("price_book_entry_inventory_items", { select: "entry_id" }),
    {
      entry_id: assertUuid(entryId),
      inventory_item_id: assertUuid(inventoryItemId),
      created_by: session.userId,
    },
  )
  assertWrote(rows, NO_CHANGE)
}

export async function unlinkInventoryItem(
  session: AccountSession,
  entryId: string,
  inventoryItemId: string,
): Promise<void> {
  const rows = await mutate(
    session,
    "DELETE",
    query("price_book_entry_inventory_items", {
      select: "entry_id",
      entry_id: `eq.${assertUuid(entryId)}`,
      inventory_item_id: `eq.${assertUuid(inventoryItemId)}`,
    }),
  )
  assertWrote(rows, NO_CHANGE)
}

export async function loadEntryAudit(
  session: AccountSession,
  entryId: string,
  hideMoney: boolean,
): Promise<AuditEvent[]> {
  const rows = await readRows(
    session,
    query("price_book_audit", {
      select: "id,occurred_at,action,table_name,inventory_item_id,before_data::text,after_data::text",
      entry_id: `eq.${assertUuid(entryId)}`,
      order: "occurred_at.desc",
      limit: "40",
    }),
  )
  return rows.map((row) => {
    const before = optionalString(row, "before_data")
    const after = optionalString(row, "after_data")
    return {
      id: requiredString(row, "id"),
      occurred_at: requiredString(row, "occurred_at"),
      action: requiredString(row, "action"),
      table_name: requiredString(row, "table_name"),
      inventory_item_id: optionalString(row, "inventory_item_id"),
      before_data: hideMoney ? redactAuditMoney(before) : before,
      after_data: hideMoney ? redactAuditMoney(after) : after,
    }
  })
}

export async function inventoryNames(session: AccountSession, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))]
  if (unique.length === 0) return {}
  const rows = await readRows(
    session,
    query("inventory_items", {
      select: "id,product_name",
      id: `in.(${unique.join(",")})`,
    }),
  )
  const names: Record<string, string> = {}
  for (const row of rows) {
    const id = optionalString(row, "id")
    if (!id) continue
    names[id] = optionalString(row, "product_name") || "Inventory record"
  }
  return names
}
