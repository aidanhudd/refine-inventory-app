"use client"

import { useEffect, useRef, useState } from "react"
import {
  AUDIT_FIELDS,
  AUDIT_MARGIN_KEYS,
  AUDIT_MONEY_KEYS,
  auditActionLabel,
  costSourceLabel,
  entryTypeLabel,
  identifierKindLabel,
  priceBookErrorMessage,
  readJsonTextField,
  readableDecimal,
  readableMoney,
  readablePercent,
  unitLabel,
} from "../../../lib/priceBook"
import {
  accountStill,
  inventoryNames,
  loadEntryAudit,
  readAccountSession,
  type AuditEvent,
} from "../../../lib/priceBookApi"
import { readHidePricesPreference } from "../../../lib/hidePrices"
import { Button, EmptyState, ModalShell, Notice } from "../../components/ui"

type PriceBookHistoryProps = {
  accountId: string
  entryId: string
  entryName: string
  hidePrices: boolean
  suppliers: { id: string; name: string }[]
  onClose: () => void
}

function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatValue(key: string, value: string, supplierNames: Map<string, string>): string {
  if (!value) return "—"
  if (AUDIT_MARGIN_KEYS.has(key)) return `${readablePercent(value)} (exact ${value})`
  if ((AUDIT_MONEY_KEYS as readonly string[]).includes(key)) return `${readableMoney(value)} (exact ${value})`
  if (key === "pricing_unit" || key === "price_basis" || key === "coverage_unit") return unitLabel(value)
  if (key === "entry_type") return entryTypeLabel(value)
  if (key === "kind") return identifierKindLabel(value)
  if (key === "cost_source") return costSourceLabel(value)
  if (key === "supplier_id") return supplierNames.get(value) ?? "Supplier"
  if (key === "price_conversion_confirmed") return value === "true" ? "Yes" : "No"
  if (key === "coverage_quantity") return readableDecimal(value)
  if (key === "status") return value === "archived" ? "Archived" : "Active"
  return value
}

export default function PriceBookHistory({
  accountId,
  entryId,
  entryName,
  hidePrices,
  suppliers,
  onClose,
}: PriceBookHistoryProps) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const request = useRef(0)
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
  const moneyHidden = hidePrices || readHidePricesPreference()

  useEffect(() => {
    const gen = ++request.current
    void (async () => {
      setLoading(true)
      setError("")
      setEvents(null)
      try {
        const session = await readAccountSession()
        if (!session || session.userId !== accountId || gen !== request.current) return
        const hideMoney = hidePrices || readHidePricesPreference()
        const next = await loadEntryAudit(session, entryId, hideMoney)
        if (gen !== request.current) return
        if (!(await accountStill(accountId))) return
        const linked = next.map((event) => event.inventory_item_id).filter((id): id is string => !!id)
        const labels = linked.length ? await inventoryNames(session, linked) : {}
        if (gen !== request.current || !(await accountStill(accountId))) return
        setNames(labels)
        setEvents(next)
      } catch (loadError) {
        if (gen !== request.current) return
        setError(priceBookErrorMessage(loadError))
        setEvents(null)
      } finally {
        if (gen === request.current) setLoading(false)
      }
    })()
  }, [accountId, entryId, hidePrices, reloadToken])

  const retry = () => setReloadToken((token) => token + 1)

  return (
    <ModalShell
      ariaLabel={`History for ${entryName}`}
      panelClassName="modal-panel modal-panel-price-book"
      onEscape={onClose}
      onOverlayClick={onClose}
    >
      <div className="modal-header">
        <h2>History</h2>
        <p className="subtext">
          Read-only record of changes to {entryName}. Amounts shown here were stored by the database.
        </p>
      </div>
      {loading && <EmptyState>Loading history...</EmptyState>}
      {error && (
        <div className="page-feedback">
          <Notice>{error}</Notice>
          <div className="action-row">
            <Button variant="secondary" size="sm" onClick={retry}>
              Retry
            </Button>
          </div>
        </div>
      )}
      {!loading && !error && events && events.length === 0 && <EmptyState>No history for this entry yet.</EmptyState>}
      {!loading && !error && events && events.length > 0 && (
        <div className="list">
          {events.map((event) => (
            <article key={event.id} className="item-card">
              <div className="price-book-meta">
                <strong>{auditActionLabel(event.action)}</strong>
                <span className="small" style={{ marginTop: 0 }}>
                  {formatWhen(event.occurred_at)}
                </span>
              </div>
              {event.inventory_item_id && (
                <p className="subtext">
                  Inventory record: {names[event.inventory_item_id] || "Inventory record"}. Linking does not change
                  stock quantity or inventory cost.
                </p>
              )}
              <AuditFields event={event} hideMoney={moneyHidden} supplierNames={supplierNames} />
            </article>
          ))}
        </div>
      )}
      <div className="modal-actions modal-actions-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </ModalShell>
  )
}

function AuditFields({
  event,
  hideMoney,
  supplierNames,
}: {
  event: AuditEvent
  hideMoney: boolean
  supplierNames: Map<string, string>
}) {
  const rows = AUDIT_FIELDS.flatMap((field) => {
    if (hideMoney && (AUDIT_MONEY_KEYS as readonly string[]).includes(field.key)) return []
    const before = event.before_data ? readJsonTextField(event.before_data, field.key) : undefined
    const after = event.after_data ? readJsonTextField(event.after_data, field.key) : undefined
    if (before === undefined && after === undefined) return []
    if ((before ?? null) === (after ?? null)) return []
    return [{ ...field, before, after }]
  })
  if (rows.length === 0) return null
  return (
    <div className="section-gap">
      {rows.map((row) => (
        <p key={row.key} className="subtext">
          <strong>{row.label}: </strong>
          {row.before !== undefined && row.after !== undefined && (row.before ?? null) !== (row.after ?? null) ? (
            <>
              {row.before == null ? "—" : formatValue(row.key, row.before, supplierNames)}
              {" → "}
              {row.after == null ? "—" : formatValue(row.key, row.after, supplierNames)}
            </>
          ) : (
            formatValue(row.key, (row.after ?? row.before) || "", supplierNames)
          )}
        </p>
      ))}
    </div>
  )
}
