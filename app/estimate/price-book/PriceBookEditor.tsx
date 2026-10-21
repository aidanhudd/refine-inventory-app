"use client"

import { FormEvent, useEffect, useId, useRef, useState } from "react"
import { readHidePricesPreference } from "../../../lib/hidePrices"
import {
  COVERAGE_UNITS,
  LABOR_UNITS,
  MATERIAL_UNITS,
  conversionCase,
  conversionExplanation,
  costSourceLabel,
  derivedCoverageUnit,
  draftFromEntry,
  emptyEntryDraft,
  entryTypeLabel,
  identifierKindLabel,
  priceBookErrorMessage,
  readableDecimal,
  readableMoney,
  readablePercent,
  unitLabel,
  validateEntryDraft,
  type EntryDraft,
  type EntryType,
  type PriceBookEntry,
  type PriceBookSupplier,
  type SupplierIdentifier,
} from "../../../lib/priceBook"
import {
  accountStill,
  linkInventoryItem,
  loadEntryLinks,
  readAccountSession,
  removeSupplierIdentifier,
  saveDirectEntry,
  saveSupplierIdentifier,
  saveSupplierMaterial,
  searchInventory,
  unlinkInventoryItem,
  type AccountSession,
  type InventoryMatch,
} from "../../../lib/priceBookApi"
import { Button, FilterCheckbox, ModalShell, Notice } from "../../components/ui"

type PriceBookEditorProps = {
  accountId: string
  canEdit: boolean
  hidePrices: boolean
  entry: PriceBookEntry | null
  identifiers: SupplierIdentifier[]
  suppliers: PriceBookSupplier[]
  companyMargin: string | null
  onClose: () => void
  onMaterialSaved: () => void
  onRefresh: () => void
  onStale: () => void
}

export default function PriceBookEditor(props: PriceBookEditorProps) {
  if (!props.canEdit || props.hidePrices || readHidePricesPreference()) return null
  return <PriceBookEditorForm key={props.entry?.id ?? "new"} {...props} />
}

function PriceBookEditorForm({
  accountId,
  entry,
  identifiers,
  suppliers,
  companyMargin,
  onClose,
  onMaterialSaved,
  onRefresh,
  onStale,
}: PriceBookEditorProps) {
  const formId = useId()
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const [draft, setDraft] = useState<EntryDraft>(() => (entry ? draftFromEntry(entry) : emptyEntryDraft()))
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState("")
  const [links, setLinks] = useState<InventoryMatch[]>([])
  const [linkQuery, setLinkQuery] = useState("")
  const [matches, setMatches] = useState<InventoryMatch[]>([])
  const [pendingRemove, setPendingRemove] = useState<"supplier_sku" | "internal" | null>(null)
  const [pendingUnlink, setPendingUnlink] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!entry || entry.entry_type !== "material") return
    const gen = { current: true }
    void (async () => {
      const session = await readAccountSession()
      if (!gen.current || !session || session.userId !== accountId) return
      try {
        const next = await loadEntryLinks(session, entry.id)
        if (!gen.current || !(await accountStill(accountId))) return
        if (!gen.current || readHidePricesPreference()) return
        setLinks(next)
      } catch (error) {
        if (gen.current) setFormError(priceBookErrorMessage(error))
      }
    })()
    return () => {
      gen.current = false
    }
  }, [accountId, entry])

  useEffect(() => {
    if (!entry || entry.entry_type !== "material") return
    const gen = { current: true }
    const handle = window.setTimeout(() => {
      void (async () => {
        const session = await readAccountSession()
        if (!gen.current || !session || session.userId !== accountId) return
        try {
          const next = await searchInventory(session, linkQuery)
          if (!gen.current) return
          if (!(await accountStill(accountId))) return
          if (!gen.current || readHidePricesPreference()) return
          setMatches(next)
        } catch (error) {
          if (gen.current) setFormError(priceBookErrorMessage(error))
        }
      })()
    }, 300)
    return () => {
      gen.current = false
      window.clearTimeout(handle)
    }
  }, [accountId, entry, linkQuery])

  async function run(task: (session: AccountSession) => Promise<void>, after?: () => void) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFormError("")
    try {
      const session = await readAccountSession()
      if (!mounted.current) return
      if (!session || session.userId !== accountId) {
        onStale()
        return
      }
      if (readHidePricesPreference()) {
        onClose()
        return
      }
      await task(session)
      if (!mounted.current) return
      if (!(await accountStill(accountId))) {
        onStale()
        return
      }
      if (readHidePricesPreference()) {
        onClose()
        return
      }
      after?.()
    } catch (error) {
      if (mounted.current) setFormError(priceBookErrorMessage(error))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function updateDraft<Key extends keyof EntryDraft>(key: Key, value: EntryDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateUnit(key: "pricingUnit" | "priceBasis", value: string) {
    setDraft((current) => {
      const next = { ...current, [key]: value }
      const pricingUnit = key === "pricingUnit" ? value : current.pricingUnit
      const priceBasis = key === "priceBasis" ? value : current.priceBasis
      next.conversionConfirmed = false
      if (pricingUnit === priceBasis) {
        if (pricingUnit !== "box") {
          next.coverageQuantity = ""
          next.coverageUnit = ""
        }
      } else {
        next.coverageUnit = derivedCoverageUnit(pricingUnit, priceBasis) ?? ""
      }
      return next
    })
  }

  function updateType(entryType: EntryType) {
    setDraft((current) => ({
      ...emptyEntryDraft(),
      entryType,
      name: current.name,
      category: current.category,
      description: current.description,
      pricingUnit: "sq_ft",
      priceBasis: entryType === "material" ? "sq_ft" : "",
    }))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = validateEntryDraft(draft, entry == null, entry?.supplier_id ?? null)
    if (problem) {
      setFormError(problem)
      return
    }
    const supplierBacked = draft.entryType === "material" && !!draft.supplierId
    const supplierChanged = !!entry && (entry.supplier_id ?? "") !== draft.supplierId
    await run(async (session) => {
      if (supplierBacked) await saveSupplierMaterial(session, entry?.id ?? null, draft, supplierChanged)
      else await saveDirectEntry(session, entry?.id ?? null, draft, entry)
    }, onMaterialSaved)
  }

  const supplierChoices = suppliers.filter(
    (supplier) => supplier.status === "active" || supplier.id === entry?.supplier_id,
  )
  const savedSupplier = (entry?.supplier_id ?? "") === draft.supplierId && !!draft.supplierId
  const assigningSupplier = !!draft.supplierId && (!entry || (entry.supplier_id ?? "") !== draft.supplierId)
  const units = draft.entryType === "material" ? conversionCase(draft.pricingUnit, draft.priceBasis) : "same"
  const conversionText =
    draft.entryType === "material" ? conversionExplanation(draft.pricingUnit, draft.priceBasis) : null
  const sku = identifiers.find((identifier) => identifier.kind === "supplier_sku")
  const internal = identifiers.find((identifier) => identifier.kind === "internal")
  const canRemoveIdentifier = identifiers.length >= 2

  return (
    <ModalShell
      ariaLabel={entry ? `Edit ${entry.name}` : "New price book entry"}
      panelClassName="modal-panel modal-panel-price-book"
      dismissDisabled={busy}
      onEscape={busy ? undefined : onClose}
      onOverlayClick={busy ? undefined : onClose}
    >
      <form onSubmit={(event) => void onSubmit(event)}>
        <div className="modal-header">
          <h2>{entry ? "Edit price book entry" : "New price book entry"}</h2>
          <p className="subtext">
            Selling prices are calculated in the database. Saving keeps the purchase cost and margin you enter here.
          </p>
        </div>
        {formError && (
          <div className="page-feedback">
            <Notice>{formError}</Notice>
          </div>
        )}
        <div className="form-grid form-grid-modal">
          {entry ? (
            <div className="field">
              <span>Type</span>
              <p>{entryTypeLabel(entry.entry_type)}</p>
              <p className="small">Entry type stays fixed. Archive this entry and create a new one to change it.</p>
            </div>
          ) : (
            <Field id={`${formId}-type`} label="Type">
              <select
                id={`${formId}-type`}
                value={draft.entryType}
                onChange={(event) => updateType(event.target.value as EntryType)}
              >
                <option value="material">Material</option>
                <option value="demolition">Demolition</option>
                <option value="installation">Installation</option>
              </select>
            </Field>
          )}
          <Field id={`${formId}-name`} label="Name">
            <input
              id={`${formId}-name`}
              value={draft.name}
              maxLength={200}
              onChange={(event) => updateDraft("name", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-category`} label="Category">
            <input
              id={`${formId}-category`}
              value={draft.category}
              maxLength={80}
              onChange={(event) => updateDraft("category", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-description`} label="Description" full>
            <textarea
              id={`${formId}-description`}
              value={draft.description}
              maxLength={4000}
              onChange={(event) => updateDraft("description", event.target.value)}
            />
          </Field>

          {draft.entryType === "material" ? (
            <MaterialFields
              formId={formId}
              draft={draft}
              entry={entry}
              supplierChoices={supplierChoices}
              companyMargin={companyMargin}
              units={units}
              conversionText={conversionText}
              savedSupplier={savedSupplier}
              assigningSupplier={assigningSupplier}
              sku={sku}
              internal={internal}
              canRemoveIdentifier={canRemoveIdentifier}
              pendingRemove={pendingRemove}
              busy={busy}
              onDraft={updateDraft}
              onUnit={updateUnit}
              onConfirmRemove={setPendingRemove}
              onSaveIdentifier={(kind, code) => {
                const trimmed = code.trim()
                if (!trimmed || !entry) {
                  setFormError("Enter a supplier SKU or an internal identifier.")
                  return
                }
                if (trimmed.length > 80) {
                  setFormError("Supplier identifiers must be 80 characters or less.")
                  return
                }
                void run(async (session) => {
                  await saveSupplierIdentifier(session, entry.id, kind, trimmed)
                  if (kind === "supplier_sku") updateDraft("replacementSku", "")
                  else updateDraft("replacementInternal", "")
                  setPendingRemove(null)
                }, onRefresh)
              }}
              onRemoveIdentifier={(kind) => {
                if (!entry) return
                if (pendingRemove !== kind) {
                  setPendingRemove(kind)
                  return
                }
                void run(async (session) => {
                  await removeSupplierIdentifier(session, entry.id, kind)
                  setPendingRemove(null)
                }, onRefresh)
              }}
            />
          ) : (
            <LaborFields formId={formId} draft={draft} onDraft={updateDraft} onUnit={updateUnit} />
          )}
        </div>

        {entry?.entry_type === "material" && (
          <InventoryLinks
            formId={formId}
            links={links}
            matches={matches}
            linkQuery={linkQuery}
            pendingUnlink={pendingUnlink}
            busy={busy}
            onQuery={setLinkQuery}
            onUnlinkPrompt={setPendingUnlink}
            onLink={(inventoryItemId) => {
              if (!entry) return
              void run(async (session) => {
                await linkInventoryItem(session, entry.id, inventoryItemId)
                const next = await loadEntryLinks(session, entry.id)
                if (mounted.current) setLinks(next)
              }, onRefresh)
            }}
            onUnlink={(inventoryItemId) => {
              if (!entry) return
              if (pendingUnlink !== inventoryItemId) {
                setPendingUnlink(inventoryItemId)
                return
              }
              void run(async (session) => {
                await unlinkInventoryItem(session, entry.id, inventoryItemId)
                setPendingUnlink(null)
                const next = await loadEntryLinks(session, entry.id)
                if (mounted.current) setLinks(next)
              }, onRefresh)
            }}
          />
        )}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving..." : "Save entry"}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

function Field({
  id,
  label,
  full = false,
  children,
}: {
  id: string
  label: string
  full?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={full ? "field field-full" : "field"}>
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

function MaterialFields({
  formId,
  draft,
  entry,
  supplierChoices,
  companyMargin,
  units,
  conversionText,
  savedSupplier,
  assigningSupplier,
  sku,
  internal,
  canRemoveIdentifier,
  pendingRemove,
  busy,
  onDraft,
  onUnit,
  onConfirmRemove,
  onSaveIdentifier,
  onRemoveIdentifier,
}: {
  formId: string
  draft: EntryDraft
  entry: PriceBookEntry | null
  supplierChoices: PriceBookSupplier[]
  companyMargin: string | null
  units: "same" | "needs-confirmation" | "invalid"
  conversionText: string | null
  savedSupplier: boolean
  assigningSupplier: boolean
  sku: SupplierIdentifier | undefined
  internal: SupplierIdentifier | undefined
  canRemoveIdentifier: boolean
  pendingRemove: "supplier_sku" | "internal" | null
  busy: boolean
  onDraft: <Key extends keyof EntryDraft>(key: Key, value: EntryDraft[Key]) => void
  onUnit: (key: "pricingUnit" | "priceBasis", value: string) => void
  onConfirmRemove: (kind: "supplier_sku" | "internal" | null) => void
  onSaveIdentifier: (kind: "supplier_sku" | "internal", code: string) => void
  onRemoveIdentifier: (kind: "supplier_sku" | "internal") => void
}) {
  return (
    <>
      <Field id={`${formId}-supplier`} label="Supplier">
        <select
          id={`${formId}-supplier`}
          value={draft.supplierId}
          onChange={(event) => onDraft("supplierId", event.target.value)}
        >
          {!entry?.supplier_id && <option value="">No supplier</option>}
          {supplierChoices.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.status === "archived" ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${formId}-pricing-unit`} label="Pricing unit">
        <UnitSelect
          id={`${formId}-pricing-unit`}
          value={draft.pricingUnit}
          options={MATERIAL_UNITS}
          onChange={(value) => onUnit("pricingUnit", value)}
        />
      </Field>
      <Field id={`${formId}-price-basis`} label="Price basis">
        <UnitSelect
          id={`${formId}-price-basis`}
          value={draft.priceBasis}
          options={MATERIAL_UNITS}
          onChange={(value) => onUnit("priceBasis", value)}
        />
      </Field>
      <Field id={`${formId}-cost`} label="Purchase cost">
        <input
          id={`${formId}-cost`}
          inputMode="decimal"
          autoComplete="off"
          value={draft.purchaseCost}
          onChange={(event) => onDraft("purchaseCost", event.target.value)}
        />
      </Field>
      <Field id={`${formId}-effective`} label="Cost effective date">
        <input
          id={`${formId}-effective`}
          type="date"
          value={draft.costEffectiveOn}
          onChange={(event) => onDraft("costEffectiveOn", event.target.value)}
        />
      </Field>
      {entry?.cost_source && (
        <div className="field field-full">
          <p className="subtext">
            Cost source: {costSourceLabel(entry.cost_source)}. Saving a different purchase cost records the source as
            manual.
          </p>
        </div>
      )}
      <div className="field field-full">
        <span>Gross margin</span>
        <div className="price-book-choice">
          <label htmlFor={`${formId}-margin-company`}>
            <input
              id={`${formId}-margin-company`}
              type="radio"
              name={`${formId}-margin`}
              checked={draft.marginMode === "company"}
              onChange={() => onDraft("marginMode", "company")}
            />
            Use company default{companyMargin ? ` (${readablePercent(companyMargin)})` : ""}
          </label>
          <label htmlFor={`${formId}-margin-item`}>
            <input
              id={`${formId}-margin-item`}
              type="radio"
              name={`${formId}-margin`}
              checked={draft.marginMode === "override"}
              onChange={() => onDraft("marginMode", "override")}
            />
            Item override
          </label>
        </div>
        <p className="small">
          Company default leaves the item override empty, including when you clear an override already saved on this
          material. Default-following materials pick up a later company margin change. An override stays until you
          clear it.
        </p>
      </div>
      {draft.marginMode === "override" && (
        <Field id={`${formId}-margin`} label="Item gross margin percent">
          <input
            id={`${formId}-margin`}
            inputMode="decimal"
            autoComplete="off"
            value={draft.marginOverride}
            onChange={(event) => onDraft("marginOverride", event.target.value)}
          />
        </Field>
      )}
      {conversionText && (
        <div className="field field-full">
          <Notice>{conversionText}</Notice>
          {units === "needs-confirmation" && (
            <div className="section-gap">
              <FilterCheckbox
                id={`${formId}-confirm`}
                label="I confirm this unit conversion."
                checked={draft.conversionConfirmed}
                onChange={(event) => onDraft("conversionConfirmed", event.target.checked)}
              />
            </div>
          )}
        </div>
      )}
      {units === "needs-confirmation" && (
        <Field id={`${formId}-coverage`} label={`Coverage quantity (${unitLabel(derivedCoverageUnit(draft.pricingUnit, draft.priceBasis))} per box)`}>
          <input
            id={`${formId}-coverage`}
            inputMode="decimal"
            autoComplete="off"
            value={draft.coverageQuantity}
            onChange={(event) => onDraft("coverageQuantity", event.target.value)}
          />
        </Field>
      )}
      {units === "same" && draft.pricingUnit === "box" && (
        <>
          <Field id={`${formId}-coverage`} label="Box coverage quantity">
            <input
              id={`${formId}-coverage`}
              inputMode="decimal"
              autoComplete="off"
              value={draft.coverageQuantity}
              onChange={(event) => onDraft("coverageQuantity", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-coverage-unit`} label="Box coverage unit">
            <UnitSelect
              id={`${formId}-coverage-unit`}
              value={draft.coverageUnit}
              options={COVERAGE_UNITS}
              allowBlank
              onChange={(value) => onDraft("coverageUnit", value)}
            />
          </Field>
        </>
      )}
      {assigningSupplier && (
        <>
          <div className="field field-full">
            <Notice>
              {entry
                ? "Enter a supplier SKU or an internal identifier for the new supplier. Codes from the previous supplier are not carried over."
                : "Assign a supplier SKU or an internal identifier. A blank code is left off this material."}
            </Notice>
          </div>
          <Field id={`${formId}-new-sku`} label="Supplier SKU">
            <input
              id={`${formId}-new-sku`}
              value={draft.newSku}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => onDraft("newSku", event.target.value)}
            />
          </Field>
          <Field id={`${formId}-new-internal`} label="Internal identifier">
            <input
              id={`${formId}-new-internal`}
              value={draft.newInternal}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => onDraft("newInternal", event.target.value)}
            />
          </Field>
        </>
      )}
      {savedSupplier && entry && (
        <div className="field field-full">
          <p className="subtext">
            Saving the material keeps the current identifiers. Replace or remove them here. Leave a replacement blank
            to keep that code. Changing the supplier requires a new code and drops the previous supplier&apos;s codes.
          </p>
          <IdentifierRow
            formId={formId}
            kind="supplier_sku"
            current={sku?.code ?? null}
            value={draft.replacementSku}
            canRemove={canRemoveIdentifier && !!sku}
            pending={pendingRemove === "supplier_sku"}
            busy={busy}
            onChange={(value) => onDraft("replacementSku", value)}
            onSave={() => onSaveIdentifier("supplier_sku", draft.replacementSku)}
            onRemove={() => onRemoveIdentifier("supplier_sku")}
            onCancelRemove={() => onConfirmRemove(null)}
          />
          <IdentifierRow
            formId={formId}
            kind="internal"
            current={internal?.code ?? null}
            value={draft.replacementInternal}
            canRemove={canRemoveIdentifier && !!internal}
            pending={pendingRemove === "internal"}
            busy={busy}
            onChange={(value) => onDraft("replacementInternal", value)}
            onSave={() => onSaveIdentifier("internal", draft.replacementInternal)}
            onRemove={() => onRemoveIdentifier("internal")}
            onCancelRemove={() => onConfirmRemove(null)}
          />
          {!canRemoveIdentifier && (
            <p className="small">A supplier-backed material must keep a supplier SKU or an internal identifier.</p>
          )}
        </div>
      )}
    </>
  )
}

function IdentifierRow({
  formId,
  kind,
  current,
  value,
  canRemove,
  pending,
  busy,
  onChange,
  onSave,
  onRemove,
  onCancelRemove,
}: {
  formId: string
  kind: "supplier_sku" | "internal"
  current: string | null
  value: string
  canRemove: boolean
  pending: boolean
  busy: boolean
  onChange: (value: string) => void
  onSave: () => void
  onRemove: () => void
  onCancelRemove: () => void
}) {
  const label = identifierKindLabel(kind)
  return (
    <div className="section-gap">
      <p>
        <strong>{label}: </strong>
        {current || "None yet"}
      </p>
      <Field id={`${formId}-${kind}`} label={`Replace ${label.toLowerCase()}`}>
        <input
          id={`${formId}-${kind}`}
          value={value}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <div className="action-row">
        <Button variant="secondary" size="sm" disabled={busy || !value.trim()} onClick={onSave}>
          Save {label.toLowerCase()}
        </Button>
        {canRemove && !pending && (
          <Button variant="danger" size="sm" disabled={busy} onClick={onRemove}>
            Remove {label.toLowerCase()}
          </Button>
        )}
        {pending && (
          <>
            <Button variant="danger" size="sm" disabled={busy} onClick={onRemove}>
              Confirm remove
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={onCancelRemove}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function LaborFields({
  formId,
  draft,
  onDraft,
  onUnit,
}: {
  formId: string
  draft: EntryDraft
  onDraft: <Key extends keyof EntryDraft>(key: Key, value: EntryDraft[Key]) => void
  onUnit: (key: "pricingUnit" | "priceBasis", value: string) => void
}) {
  const flat = draft.pricingUnit === "flat"
  return (
    <>
      <Field id={`${formId}-pricing-unit`} label="Selling rate unit">
        <UnitSelect
          id={`${formId}-pricing-unit`}
          value={draft.pricingUnit}
          options={LABOR_UNITS}
          onChange={(value) => onUnit("pricingUnit", value)}
        />
      </Field>
      <Field id={`${formId}-rate`} label={flat ? "Flat selling amount" : "Selling rate per sq ft"}>
        <input
          id={`${formId}-rate`}
          inputMode="decimal"
          autoComplete="off"
          value={draft.laborRate}
          onChange={(event) => onDraft("laborRate", event.target.value)}
        />
      </Field>
      <div className="field field-full">
        <p className="subtext">
          Demolition and installation use a manual selling rate. They do not store a supplier, purchase cost, margin,
          or coverage.
          {flat ? " A flat amount is one charge." : " Square-foot labor extends by the quantity on an estimate later."}
        </p>
      </div>
    </>
  )
}

function UnitSelect({
  id,
  value,
  options,
  allowBlank = false,
  onChange,
}: {
  id: string
  value: string
  options: readonly string[]
  allowBlank?: boolean
  onChange: (value: string) => void
}) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {allowBlank && <option value="">Not recorded</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {unitLabel(option)}
        </option>
      ))}
    </select>
  )
}

function InventoryLinks({
  formId,
  links,
  matches,
  linkQuery,
  pendingUnlink,
  busy,
  onQuery,
  onUnlinkPrompt,
  onLink,
  onUnlink,
}: {
  formId: string
  links: InventoryMatch[]
  matches: InventoryMatch[]
  linkQuery: string
  pendingUnlink: string | null
  busy: boolean
  onQuery: (value: string) => void
  onUnlinkPrompt: (id: string | null) => void
  onLink: (id: string) => void
  onUnlink: (id: string) => void
}) {
  const linked = new Set(links.map((link) => link.id))
  return (
    <div className="section-gap">
      <h3>Inventory links</h3>
      <Notice>
        Linking a material to inventory records does not change stock quantity or inventory cost. One material can link
        to several records. Each inventory record can link to only one material.
      </Notice>
      {links.length === 0 && <p className="subtext">No inventory records are linked yet.</p>}
      <div className="list section-gap">
        {links.map((link) => (
          <article key={link.id} className="item-card">
            <strong>{link.product_name || "Inventory record"}</strong>
            <p className="subtext">
              {link.sku ? `SKU ${link.sku}. ` : ""}
              On hand {readableDecimal(link.quantity_on_hand)}.
              {link.unit_cost ? ` Inventory unit cost ${readableMoney(link.unit_cost)} (exact ${link.unit_cost}).` : ""}
            </p>
            <div className="action-row">
              {pendingUnlink === link.id ? (
                <>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => onUnlink(link.id)}>
                    Confirm unlink
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => onUnlinkPrompt(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => onUnlink(link.id)}>
                  Unlink
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <Field id={`${formId}-inventory-search`} label="Find an inventory record">
        <input
          id={`${formId}-inventory-search`}
          type="search"
          value={linkQuery}
          autoComplete="off"
          placeholder="Name or SKU"
          onChange={(event) => onQuery(event.target.value)}
        />
      </Field>
      <div className="list section-gap">
        {matches
          .filter((match) => !linked.has(match.id))
          .map((match) => (
            <article key={match.id} className="item-card">
              <strong>{match.product_name || "Inventory record"}</strong>
              <p className="subtext">
                {match.sku ? `SKU ${match.sku}. ` : ""}
                On hand {readableDecimal(match.quantity_on_hand)}.
                {match.unit_cost
                  ? ` Inventory unit cost ${readableMoney(match.unit_cost)} (exact ${match.unit_cost}).`
                  : ""}
              </p>
              <div className="action-row">
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => onLink(match.id)}>
                  Link inventory record
                </Button>
              </div>
            </article>
          ))}
      </div>
    </div>
  )
}
