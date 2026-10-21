"use client"

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useAuth } from "../../components/AuthProvider"
import { useHidePrices } from "../../components/HidePricesProvider"
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ModalShell,
  Notice,
  PageHeader,
  SearchField,
  Toolbar,
} from "../../components/ui"
import { readHidePricesPreference } from "../../../lib/hidePrices"
import { hasAppAccess, isManagerOrAdmin } from "../../../lib/profiles"
import {
  entryTypeLabel,
  filterPriceBookEntries,
  identifierKindLabel,
  MATERIAL_CALCULATION_UNAVAILABLE,
  grossMarginDetailLine,
  materialCalculationDetail,
  materialsForSellingPrices,
  pagePriceBookEntries,
  PRICE_BOOK_DISPLAY_PAGE_SIZE,
  priceBookErrorMessage,
  PURCHASE_TAX_UNAVAILABLE,
  readableDecimal,
  readableMoney,
  readablePercent,
  unitLabel,
  validateMarginInput,
  validatePurchaseTaxInput,
  validateSampleQuantity,
  type PriceBookEntry,
} from "../../../lib/priceBook"
import {
  accountStill,
  loadPriceBook,
  readAccountSession,
  readMaterialPrice,
  type MaterialCalculation,
  sampleLaborLineTotal,
  sampleMaterialLineTotal,
  saveCompanyMargin,
  saveCompanyPurchaseTax,
  saveSupplier,
  setEntryStatus,
  setSupplierStatus,
  stripCatalogMoney,
  type AccountSession,
  type PriceBookCatalog,
} from "../../../lib/priceBookApi"
import PriceBookEditor from "./PriceBookEditor"
import PriceBookHistory from "./PriceBookHistory"

type MaterialPrice =
  | { status: "loading" }
  | { status: "ready"; exact: string; calculation: MaterialCalculation | null; calculationMessage: string | null }
  | { status: "error"; message: string }

type SupplierDraft = { id: string | null; name: string; notes: string }

export default function PriceBookPage() {
  const { user, profile } = useAuth()
  const { hidePrices } = useHidePrices()
  if (!user || !profile || !hasAppAccess(profile)) {
    return (
      <main className="price-book-page">
        <EmptyState>Checking access...</EmptyState>
      </main>
    )
  }

  return (
    <PriceBookScreen
      key={user.id}
      accountId={user.id}
      canEdit={profile.approved && isManagerOrAdmin(profile.role)}
      hidePrices={hidePrices}
    />
  )
}

function PriceBookScreen({
  accountId,
  canEdit,
  hidePrices,
}: {
  accountId: string
  canEdit: boolean
  hidePrices: boolean
}) {
  const mounted = useRef(true)
  const loadGen = useRef(0)
  const pageBusyRef = useRef(false)
  const catalogRef = useRef<PriceBookCatalog | null>(null)
  const [catalog, setCatalogState] = useState<PriceBookCatalog | null>(null)
  const [prices, setPrices] = useState<Record<string, MaterialPrice>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [pageBusy, setPageBusy] = useState(false)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("active")
  const [listPage, setListPage] = useState(0)
  const [editor, setEditor] = useState<PriceBookEntry | "new" | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft | null>(null)
  const [pendingArchive, setPendingArchive] = useState<{ kind: "entry" | "supplier"; id: string } | null>(null)
  const [marginInput, setMarginInput] = useState("")
  const [purchaseTaxInput, setPurchaseTaxInput] = useState("")

  const setCatalog = useCallback((next: PriceBookCatalog | null) => {
    catalogRef.current = next
    setCatalogState(next)
  }, [])

  const priceGen = useRef(0)

  const fillPrices = useCallback(
    async (entries: PriceBookEntry[], session: AccountSession, gen: number) => {
      const materials = materialsForSellingPrices(entries)
      setPrices(Object.fromEntries(materials.map((entry) => [entry.id, { status: "loading" }])))
      let index = 0
      const worker = async () => {
        while (index < materials.length) {
          const entry = materials[index]
          index += 1
          if (gen !== priceGen.current || readHidePricesPreference()) return
          try {
            const price = await readMaterialPrice(session, entry.id)
            if (gen !== priceGen.current || readHidePricesPreference()) return
            if (!(await accountStill(accountId))) return
            if (gen !== priceGen.current || readHidePricesPreference()) return
            setPrices((current) => ({ ...current, [entry.id]: { status: "ready", ...price } }))
          } catch (error) {
            if (gen !== priceGen.current || readHidePricesPreference()) return
            setPrices((current) => ({
              ...current,
              [entry.id]: { status: "error", message: priceBookErrorMessage(error) },
            }))
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, materials.length) }, () => worker()))
    },
    [accountId],
  )

  const load = useCallback(async () => {
    const gen = ++loadGen.current
    if (!catalogRef.current) setLoading(true)
    const session = await readAccountSession()
    if (!mounted.current || gen !== loadGen.current) return
    if (!session || session.userId !== accountId) {
      setLoadError("Sign in again to use the price book.")
      setLoading(false)
      return
    }
    const includeMoney = !hidePrices && !readHidePricesPreference()
    if (!includeMoney) setPrices({})
    try {
      const next = await loadPriceBook(session, includeMoney)
      if (!mounted.current || gen !== loadGen.current) return
      if (!(await accountStill(accountId))) {
        setLoadError("The signed-in account changed. Refresh the price book before trying again.")
        return
      }
      if (!mounted.current || gen !== loadGen.current) return
      const stillShowMoney = !hidePrices && !readHidePricesPreference()
      setCatalog(stillShowMoney ? next : stripCatalogMoney(next))
      setLoadError("")
      if (!stillShowMoney) setPrices({})
    } catch (error) {
      if (!mounted.current || gen !== loadGen.current) return
      setLoadError(priceBookErrorMessage(error))
    } finally {
      if (mounted.current && gen === loadGen.current) setLoading(false)
    }
  }, [accountId, hidePrices, setCatalog])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      loadGen.current += 1
    }
  }, [load])

  useEffect(() => {
    if (!hidePrices) return
    setEditor(null)
    setPrices({})
    if (catalogRef.current) setCatalog(stripCatalogMoney(catalogRef.current))
  }, [hidePrices, setCatalog])

  useEffect(() => {
    if (catalog?.companyMargin && !pageBusy) setMarginInput(catalog.companyMargin)
  }, [catalog?.companyMargin, pageBusy])

  useEffect(() => {
    if (catalog?.companyPurchaseTax && !pageBusy) setPurchaseTaxInput(catalog.companyPurchaseTax)
  }, [catalog?.companyPurchaseTax, pageBusy])

  const suppliersById = useMemo(
    () => new Map((catalog?.suppliers ?? []).map((supplier) => [supplier.id, supplier])),
    [catalog?.suppliers],
  )
  const identifiersByEntry = useMemo(() => {
    const grouped = new Map<string, PriceBookCatalog["identifiers"]>()
    for (const identifier of catalog?.identifiers ?? []) {
      const list = grouped.get(identifier.entry_id) ?? []
      list.push(identifier)
      grouped.set(identifier.entry_id, list)
    }
    return grouped
  }, [catalog?.identifiers])
  const categories = useMemo(() => {
    const names = new Set<string>()
    for (const entry of catalog?.entries ?? []) {
      if (entry.category) names.add(entry.category)
    }
    return [...names].sort((left, right) => left.localeCompare(right))
  }, [catalog?.entries])

  const visibleEntries = useMemo(
    () =>
      filterPriceBookEntries(catalog?.entries ?? [], catalog?.identifiers ?? [], {
        search,
        entryType: typeFilter,
        category: categoryFilter,
        supplierId: supplierFilter,
        status: statusFilter,
      }),
    [catalog?.entries, catalog?.identifiers, categoryFilter, search, statusFilter, supplierFilter, typeFilter],
  )
  const pagedEntries = useMemo(
    () => pagePriceBookEntries(visibleEntries, listPage, PRICE_BOOK_DISPLAY_PAGE_SIZE),
    [listPage, visibleEntries],
  )
  const displayedIds = pagedEntries.items.map((entry) => entry.id).join("\n")

  useEffect(() => {
    setListPage(0)
  }, [search, typeFilter, categoryFilter, supplierFilter, statusFilter])

  useEffect(() => {
    if (listPage !== pagedEntries.pageIndex) setListPage(pagedEntries.pageIndex)
  }, [listPage, pagedEntries.pageIndex])

  useEffect(() => {
    const gen = ++priceGen.current
    if (hidePrices || readHidePricesPreference()) {
      setPrices({})
      return
    }
    const displayed = new Set(displayedIds ? displayedIds.split("\n") : [])
    const materials = materialsForSellingPrices((catalog?.entries ?? []).filter((entry) => displayed.has(entry.id)))
    if (materials.length === 0) {
      setPrices({})
      return
    }
    void (async () => {
      const session = await readAccountSession()
      if (gen !== priceGen.current || !session || session.userId !== accountId) return
      await fillPrices(materials, session, gen)
    })()
    return () => {
      priceGen.current += 1
    }
  }, [accountId, catalog, displayedIds, fillPrices, hidePrices])

  async function runPage(task: (session: AccountSession) => Promise<void>) {
    if (pageBusyRef.current) return
    pageBusyRef.current = true
    setPageBusy(true)
    setActionError("")
    try {
      const session = await readAccountSession()
      if (!session || session.userId !== accountId) {
        setActionError("Sign in again to use the price book.")
        return
      }
      await task(session)
      if (!(await accountStill(accountId))) {
        setEditor(null)
        setSupplierDraft(null)
        setActionError("The signed-in account changed. Refresh the price book before trying again.")
        return
      }
      await load()
    } catch (error) {
      setActionError(priceBookErrorMessage(error))
    } finally {
      pageBusyRef.current = false
      setPageBusy(false)
    }
  }

  async function retryPrice(entryId: string) {
    if (hidePrices || readHidePricesPreference()) {
      setPrices({})
      return
    }
    const session = await readAccountSession()
    if (!session || session.userId !== accountId) return
    setPrices((current) => ({ ...current, [entryId]: { status: "loading" } }))
    try {
      const price = await readMaterialPrice(session, entryId)
      if (readHidePricesPreference() || hidePrices) return
      if (!(await accountStill(accountId))) return
      if (readHidePricesPreference() || hidePrices) return
      setPrices((current) => ({ ...current, [entryId]: { status: "ready", ...price } }))
    } catch (error) {
      if (readHidePricesPreference()) return
      setPrices((current) => ({
        ...current,
        [entryId]: { status: "error", message: priceBookErrorMessage(error) },
      }))
    }
  }

  function saveMargin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || hidePrices || readHidePricesPreference()) return
    const problem = validateMarginInput(marginInput)
    if (problem) {
      setActionError(problem)
      return
    }
    void runPage((session) => saveCompanyMargin(session, marginInput))
  }

  function savePurchaseTax(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || hidePrices || readHidePricesPreference() || !catalog?.purchaseTaxAvailable) return
    const problem = validatePurchaseTaxInput(purchaseTaxInput)
    if (problem) {
      setActionError(problem)
      return
    }
    void runPage((session) => saveCompanyPurchaseTax(session, purchaseTaxInput))
  }

  function saveSupplierDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEdit || !supplierDraft) return
    const name = supplierDraft.name.trim()
    if (!name) {
      setActionError("Enter a supplier name.")
      return
    }
    if (name.length > 200) {
      setActionError("Supplier name must be 200 characters or less.")
      return
    }
    if (supplierDraft.notes.trim().length > 4000) {
      setActionError("Supplier notes must be 4000 characters or less.")
      return
    }
    const draft = supplierDraft
    void runPage(async (session) => {
      await saveSupplier(session, draft.id, draft.name, draft.notes)
      setSupplierDraft(null)
    })
  }

  const historyEntry = catalog?.entries.find((entry) => entry.id === historyId) ?? null
  const editingEntry =
    editor && editor !== "new" ? catalog?.entries.find((entry) => entry.id === editor.id) ?? editor : null

  return (
    <main className="price-book-page">
      <PageHeader
        title="Price book"
        description="Material, demolition, and installation prices for estimates. The estimate scratchpad is still separate and unsaved."
      />
      <div className="action-row" style={{ marginTop: 0 }}>
        <Link href="/estimate" className="nav-link">
          Estimate scratchpad
        </Link>
      </div>

      {!canEdit && (
        <p className="subtext">You can browse the price book. Only managers and admins can change the price book.</p>
      )}
      {canEdit && hidePrices && (
        <Notice>
          Turn off Hide Prices to add or edit entries, the company margin, supplier identifiers, and inventory links.
          {catalog?.purchaseTaxAvailable ? " Material purchase tax can be edited then too." : ""} Archive, restore,
          and supplier names stay available.
        </Notice>
      )}
      {actionError && <Notice>{actionError}</Notice>}
      {loadError && (
        <div>
          <Notice>{loadError}</Notice>
          <div className="action-row">
            <Button variant="secondary" onClick={() => void load()} disabled={pageBusy}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {catalog && !catalog.settingsPresent && !loadError && (
        <Notice>Company gross margin is not available. Retry after the price book settings are in place.</Notice>
      )}

      {catalog?.settingsPresent && (
        <Card>
          <h2>Company gross margin</h2>
          <p className="subtext">
            The company default starts at 40% gross margin. Materials that follow the default use the current company
            margin when their selling price is calculated. Changing it affects those materials. An item override stays
            until it is cleared. Saved estimate prices stay fixed once estimates are saved. This page does not save
            estimates.
          </p>
          {hidePrices ? (
            <p className="subtext">The company gross margin is hidden while Hide Prices is on.</p>
          ) : canEdit ? (
            <form onSubmit={saveMargin} className="form-grid section-gap">
              <div className="field">
                <label htmlFor="company-margin">Default gross margin percent</label>
                <input
                  id="company-margin"
                  inputMode="decimal"
                  autoComplete="off"
                  value={marginInput}
                  onChange={(event) => setMarginInput(event.target.value)}
                />
              </div>
              <div className="action-row">
                <Button type="submit" variant="primary" disabled={pageBusy}>
                  {pageBusy ? "Saving..." : "Save company margin"}
                </Button>
              </div>
            </form>
          ) : (
            <p className="section-gap">Company default gross margin: {readablePercent(catalog.companyMargin)}</p>
          )}
        </Card>
      )}

      {catalog?.purchaseTaxAvailable === false && <Notice>{PURCHASE_TAX_UNAVAILABLE}</Notice>}

      {catalog?.purchaseTaxAvailable && catalog.settingsPresent && (
        <Card>
          <h2>Material purchase tax</h2>
          <p className="subtext">
            The company default starts at 7%. Supplier prices and purchase costs exclude this tax. It is the tax the
            company pays on materials, separate from tax charged to a customer. Every material uses the current company
            rate. There is no per-item purchase-tax override. Changing it affects material selling prices. Saved
            estimate prices stay fixed once estimates are saved. This page does not save estimates.
          </p>
          {hidePrices ? (
            <p className="subtext">The material purchase tax is hidden while Hide Prices is on.</p>
          ) : canEdit ? (
            <form onSubmit={savePurchaseTax} className="form-grid section-gap">
              <div className="field">
                <label htmlFor="company-purchase-tax">Material purchase tax percent</label>
                <input
                  id="company-purchase-tax"
                  inputMode="decimal"
                  autoComplete="off"
                  value={purchaseTaxInput}
                  onChange={(event) => setPurchaseTaxInput(event.target.value)}
                />
              </div>
              <div className="action-row">
                <Button type="submit" variant="primary" disabled={pageBusy}>
                  {pageBusy ? "Saving..." : "Save material purchase tax"}
                </Button>
              </div>
            </form>
          ) : catalog.companyPurchaseTax ? (
            <p className="section-gap">
              Material purchase tax: {readablePercent(catalog.companyPurchaseTax)}{" "}
              <span className="small">exact {catalog.companyPurchaseTax}</span>
            </p>
          ) : (
            <Notice>Material purchase tax was not returned. Retry after the database update is in place.</Notice>
          )}
        </Card>
      )}

      {canEdit && catalog && (
        <Card>
          <div className="price-book-meta">
            <h2>Suppliers</h2>
            <Button
              variant="primary"
              size="sm"
              disabled={pageBusy}
              onClick={() => setSupplierDraft({ id: null, name: "", notes: "" })}
            >
              New supplier
            </Button>
          </div>
          {catalog.suppliers.length === 0 && <p className="subtext">No suppliers yet.</p>}
          <div className="list section-gap">
            {catalog.suppliers.map((supplier) => (
              <article key={supplier.id} className="item-card">
                <div className="price-book-meta">
                  <strong>{supplier.name}</strong>
                  {supplier.status === "archived" && <Badge tone="alert">Archived</Badge>}
                </div>
                {supplier.notes && <p className="subtext">{supplier.notes}</p>}
                <div className="action-row">
                  <Button
                    variant="edit"
                    size="sm"
                    disabled={pageBusy}
                    onClick={() =>
                      setSupplierDraft({ id: supplier.id, name: supplier.name, notes: supplier.notes ?? "" })
                    }
                  >
                    Edit supplier
                  </Button>
                  {supplier.status === "active" ? (
                    pendingArchive?.kind === "supplier" && pendingArchive.id === supplier.id ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={pageBusy}
                          onClick={() =>
                            void runPage(async (session) => {
                              await setSupplierStatus(session, supplier.id, "archived")
                              setPendingArchive(null)
                            })
                          }
                        >
                          Confirm archive
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pageBusy}
                          onClick={() => setPendingArchive(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pageBusy}
                        onClick={() => setPendingArchive({ kind: "supplier", id: supplier.id })}
                      >
                        Archive supplier
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pageBusy}
                      onClick={() => void runPage((session) => setSupplierStatus(session, supplier.id, "active"))}
                    >
                      Restore supplier
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}

      <Toolbar className="price-book-filters">
        <div className="field field-grow">
          <label htmlFor="price-book-search">Search</label>
          <SearchField
            id="price-book-search"
            value={search}
            placeholder="Name or supplier identifier"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <FilterSelect id="price-book-type" label="Type" value={typeFilter} onChange={setTypeFilter}>
          <option value="all">All types</option>
          <option value="material">Material</option>
          <option value="demolition">Demolition</option>
          <option value="installation">Installation</option>
        </FilterSelect>
        <FilterSelect id="price-book-category" label="Category" value={categoryFilter} onChange={setCategoryFilter}>
          <option value="all">All categories</option>
          <option value="none">No category</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id="price-book-supplier" label="Supplier" value={supplierFilter} onChange={setSupplierFilter}>
          <option value="all">All suppliers</option>
          <option value="none">No supplier</option>
          {(catalog?.suppliers ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.status === "archived" ? " (archived)" : ""}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect id="price-book-status" label="Status" value={statusFilter} onChange={setStatusFilter}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">Active and archived</option>
        </FilterSelect>
        {canEdit && !hidePrices && (
          <Button variant="primary" disabled={pageBusy} onClick={() => setEditor("new")}>
            New entry
          </Button>
        )}
      </Toolbar>

      {loading && !catalog && <EmptyState>Loading the price book...</EmptyState>}
      {!loading && catalog && visibleEntries.length === 0 && (
        <EmptyState>
          {catalog.entries.length === 0 ? "No price book entries yet." : "No price book entries match these filters."}
        </EmptyState>
      )}

      {catalog && visibleEntries.length > 0 && (
        <div className="action-row price-book-pager">
          <p className="subtext">
            {pagedEntries.from}–{pagedEntries.to} of {pagedEntries.total}
          </p>
          {pagedEntries.pageCount > 1 && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={pagedEntries.pageIndex === 0}
                onClick={() => setListPage(pagedEntries.pageIndex - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={pagedEntries.pageIndex >= pagedEntries.pageCount - 1}
                onClick={() => setListPage(pagedEntries.pageIndex + 1)}
              >
                Next
              </Button>
            </>
          )}
        </div>
      )}

      <div className="list">
        {pagedEntries.items.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            supplierName={entry.supplier_id ? suppliersById.get(entry.supplier_id)?.name ?? "Supplier" : null}
            identifiers={identifiersByEntry.get(entry.id) ?? []}
            price={prices[entry.id]}
            companyMargin={hidePrices ? null : catalog?.companyMargin ?? null}
            companyPurchaseTax={hidePrices ? null : catalog?.companyPurchaseTax ?? null}
            purchaseTaxAvailable={catalog?.purchaseTaxAvailable === true}
            hidePrices={hidePrices}
            canEdit={canEdit}
            pageBusy={pageBusy}
            pendingArchive={pendingArchive?.kind === "entry" && pendingArchive.id === entry.id}
            accountId={accountId}
            onRetryPrice={() => void retryPrice(entry.id)}
            onEdit={() => setEditor(entry)}
            onHistory={() => setHistoryId(entry.id)}
            onArchivePrompt={() => setPendingArchive({ kind: "entry", id: entry.id })}
            onArchiveCancel={() => setPendingArchive(null)}
            onArchive={() =>
              void runPage(async (session) => {
                await setEntryStatus(session, entry.id, "archived")
                setPendingArchive(null)
              })
            }
            onRestore={() => void runPage((session) => setEntryStatus(session, entry.id, "active"))}
          />
        ))}
      </div>

      {editor && canEdit && !hidePrices && catalog && (
        <PriceBookEditor
          accountId={accountId}
          canEdit={canEdit}
          hidePrices={hidePrices}
          entry={editor === "new" ? null : editingEntry}
          identifiers={editor === "new" || !editingEntry ? [] : identifiersByEntry.get(editingEntry.id) ?? []}
          suppliers={catalog.suppliers}
          companyMargin={catalog.companyMargin}
          companyPurchaseTax={catalog.companyPurchaseTax}
          purchaseTaxAvailable={catalog.purchaseTaxAvailable}
          onClose={() => setEditor(null)}
          onMaterialSaved={() => {
            setEditor(null)
            void load()
          }}
          onRefresh={() => void load()}
          onStale={() => {
            setEditor(null)
            setActionError("The signed-in account changed. Refresh the price book before saving again.")
            void load()
          }}
        />
      )}

      {historyEntry && (
        <PriceBookHistory
          accountId={accountId}
          entryId={historyEntry.id}
          entryName={historyEntry.name}
          hidePrices={hidePrices}
          suppliers={catalog?.suppliers ?? []}
          onClose={() => setHistoryId(null)}
        />
      )}

      {supplierDraft && canEdit && (
        <ModalShell
          ariaLabel={supplierDraft.id ? "Edit supplier" : "New supplier"}
          panelClassName="modal-panel modal-panel-price-book"
          dismissDisabled={pageBusy}
          onEscape={pageBusy ? undefined : () => setSupplierDraft(null)}
          onOverlayClick={pageBusy ? undefined : () => setSupplierDraft(null)}
        >
          <form onSubmit={saveSupplierDraft}>
            <div className="modal-header">
              <h2>{supplierDraft.id ? "Edit supplier" : "New supplier"}</h2>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="supplier-name">Supplier name</label>
                <input
                  id="supplier-name"
                  value={supplierDraft.name}
                  maxLength={200}
                  onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="supplier-notes">Notes</label>
                <textarea
                  id="supplier-notes"
                  value={supplierDraft.notes}
                  maxLength={4000}
                  onChange={(event) => setSupplierDraft({ ...supplierDraft, notes: event.target.value })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <Button variant="secondary" disabled={pageBusy} onClick={() => setSupplierDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pageBusy}>
                {pageBusy ? "Saving..." : "Save supplier"}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}
    </main>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  )
}

function EntryCard({
  entry,
  supplierName,
  identifiers,
  price,
  companyMargin,
  companyPurchaseTax,
  purchaseTaxAvailable,
  hidePrices,
  canEdit,
  pageBusy,
  pendingArchive,
  accountId,
  onRetryPrice,
  onEdit,
  onHistory,
  onArchivePrompt,
  onArchiveCancel,
  onArchive,
  onRestore,
}: {
  entry: PriceBookEntry
  supplierName: string | null
  identifiers: PriceBookCatalog["identifiers"]
  price: MaterialPrice | undefined
  companyMargin: string | null
  companyPurchaseTax: string | null
  purchaseTaxAvailable: boolean
  hidePrices: boolean
  canEdit: boolean
  pageBusy: boolean
  pendingArchive: boolean
  accountId: string
  onRetryPrice: () => void
  onEdit: () => void
  onHistory: () => void
  onArchivePrompt: () => void
  onArchiveCancel: () => void
  onArchive: () => void
  onRestore: () => void
}) {
  const showMoney = !hidePrices
  const canOpenEditor =
    canEdit &&
    showMoney &&
    (entry.entry_type === "material" ? entry.purchase_cost != null : entry.labor_selling_rate != null)

  return (
    <article className="item-card">
      <div className="price-book-meta">
        <Badge>{entryTypeLabel(entry.entry_type)}</Badge>
        {entry.status === "archived" && <Badge tone="alert">Archived</Badge>}
        {entry.category && (
          <span className="small" style={{ marginTop: 0 }}>
            {entry.category}
          </span>
        )}
      </div>
      <h3>{entry.name}</h3>
      <p className="subtext">
        Pricing unit: {entry.pricing_unit === "flat" ? "flat amount" : `per ${unitLabel(entry.pricing_unit)}`}
        {supplierName ? ` · ${supplierName}` : ""}
      </p>
      {identifiers.length > 0 && (
        <p className="subtext">
          {identifiers.map((identifier) => `${identifierKindLabel(identifier.kind)} ${identifier.code}`).join(" · ")}
        </p>
      )}
      {entry.entry_type === "material" && (entry.cost_effective_on || entry.cost_source) && (
        <p className="subtext">
          {entry.cost_source ? `Cost source ${entry.cost_source === "pdf_import" ? "PDF import" : "manual"}` : ""}
          {entry.cost_source && entry.cost_effective_on ? " · " : ""}
          {entry.cost_effective_on ? `Effective ${entry.cost_effective_on}` : ""}
        </p>
      )}
      {showMoney ? (
        <SellingPrice
          entry={entry}
          price={price}
          companyMargin={companyMargin}
          companyPurchaseTax={companyPurchaseTax}
          purchaseTaxAvailable={purchaseTaxAvailable}
          accountId={accountId}
          onRetry={onRetryPrice}
        />
      ) : (
        <p className="subtext">Prices hidden</p>
      )}
      <div className="action-row">
        <Button variant="secondary" size="sm" onClick={onHistory}>
          History
        </Button>
        {canOpenEditor && (
          <Button variant="edit" size="sm" disabled={pageBusy} onClick={onEdit}>
            Edit
          </Button>
        )}
        {canEdit && entry.status === "active" && !pendingArchive && (
          <Button variant="secondary" size="sm" disabled={pageBusy} onClick={onArchivePrompt}>
            Archive
          </Button>
        )}
        {canEdit && pendingArchive && (
          <>
            <Button variant="danger" size="sm" disabled={pageBusy} onClick={onArchive}>
              Confirm archive
            </Button>
            <Button variant="secondary" size="sm" disabled={pageBusy} onClick={onArchiveCancel}>
              Cancel
            </Button>
          </>
        )}
        {canEdit && entry.status === "archived" && (
          <Button variant="secondary" size="sm" disabled={pageBusy} onClick={onRestore}>
            Restore
          </Button>
        )}
      </div>
    </article>
  )
}

function DetailAmount({ label, value }: { label: string; value: string }) {
  return (
    <p className="subtext">
      {label}: {readableMoney(value)} <span className="small">exact {value}</span>
    </p>
  )
}

function GrossMarginDetail({
  entry,
  companyMargin,
}: {
  entry: PriceBookEntry
  companyMargin: string | null
}) {
  return <p className="subtext">{grossMarginDetailLine(entry.gross_margin_percent_override, companyMargin)}</p>
}

function MaterialBreakdown({
  calculation,
  entry,
  companyMargin,
}: {
  calculation: MaterialCalculation
  entry: PriceBookEntry
  companyMargin: string | null
}) {
  return (
    <>
      <DetailAmount label="Pretax supplier cost per pricing unit" value={calculation.pretaxCostPerPricingUnit} />
      <p className="subtext">
        Material purchase tax: {readablePercent(calculation.purchaseTaxPercent)} (
        {readableMoney(calculation.purchaseTaxAmount)}){" "}
        <span className="small">
          exact rate {calculation.purchaseTaxPercent}; exact amount {calculation.purchaseTaxAmount}
        </span>
      </p>
      <GrossMarginDetail entry={entry} companyMargin={companyMargin} />
      <DetailAmount label="Tax-inclusive cost per pricing unit" value={calculation.taxInclusiveCostPerPricingUnit} />
      <DetailAmount label="Gross profit" value={calculation.grossProfitAmount} />
      <p className="subtext">Gross profit is the unit selling price minus the tax-inclusive cost, rounded to cents.</p>
      <DetailAmount label="Final unit selling price" value={calculation.unitSellingPrice} />
      <DetailAmount label="One unit line total" value={calculation.oneUnitLineTotal} />
    </>
  )
}

function SellingPrice({
  entry,
  price,
  companyMargin,
  companyPurchaseTax,
  purchaseTaxAvailable,
  accountId,
  onRetry,
}: {
  entry: PriceBookEntry
  price: MaterialPrice | undefined
  companyMargin: string | null
  companyPurchaseTax: string | null
  purchaseTaxAvailable: boolean
  accountId: string
  onRetry: () => void
}) {
  if (entry.entry_type !== "material") {
    if (!entry.labor_selling_rate) return <p className="subtext">Selling rate is unavailable.</p>
    return (
      <>
        <p>
          Selling rate: {readableMoney(entry.labor_selling_rate)}{" "}
          <span className="small">exact {entry.labor_selling_rate}</span>
        </p>
        <details className="price-book-details">
          <summary>Calculation details</summary>
          <p className="subtext">
            This rate is stored on the entry. Demolition and installation do not use material purchase tax or gross
            margin. A sample line total is calculated by the database when you ask for it.
            {entry.pricing_unit === "flat" ? " Flat labor is one charge." : ""}
          </p>
          <SampleLine
            accountId={accountId}
            entryId={entry.id}
            kind="labor"
            pricingUnit={entry.pricing_unit}
            rate={entry.labor_selling_rate}
          />
        </details>
      </>
    )
  }

  const marginText =
    entry.gross_margin_percent_override != null
      ? `Item margin ${readablePercent(entry.gross_margin_percent_override)}`
      : `Uses company default${companyMargin ? ` (${readablePercent(companyMargin)})` : ""}`

  return (
    <>
      <p className="subtext">{marginText}</p>
      {(!price || price.status === "loading") && <p className="subtext">Calculating selling price...</p>}
      {price?.status === "error" && (
        <div>
          <p className="subtext">{price.message}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry price
          </Button>
        </div>
      )}
      {price?.status === "ready" && (
        <>
          <p>
            Selling price: {readableMoney(price.exact)} <span className="small">exact {price.exact}</span>
          </p>
          <details className="price-book-details">
            <summary>Calculation details</summary>
            <p className="subtext">{materialCalculationDetail(purchaseTaxAvailable, companyPurchaseTax)}</p>
            {price.calculation ? (
              <MaterialBreakdown calculation={price.calculation} entry={entry} companyMargin={companyMargin} />
            ) : (
              <>
                <Notice>{price.calculationMessage || MATERIAL_CALCULATION_UNAVAILABLE}</Notice>
                {purchaseTaxAvailable && companyPurchaseTax ? (
                  <p className="subtext">
                    Material purchase tax: {readablePercent(companyPurchaseTax)}{" "}
                    <span className="small">exact {companyPurchaseTax}</span>
                  </p>
                ) : null}
                <GrossMarginDetail entry={entry} companyMargin={companyMargin} />
              </>
            )}
            <p className="subtext">
              Supplier purchase cost excluding purchase tax: {readableMoney(entry.purchase_cost)} (exact{" "}
              {entry.purchase_cost ?? "—"})
            </p>
            <p className="subtext">
              Price basis: {unitLabel(entry.price_basis)}. Pricing unit: {unitLabel(entry.pricing_unit)}.
              {entry.coverage_quantity
                ? ` Coverage ${readableDecimal(entry.coverage_quantity)} ${unitLabel(entry.coverage_unit)}.`
                : ""}
              {entry.price_conversion_confirmed ? " Unit conversion confirmed." : ""}
            </p>
            <SampleLine accountId={accountId} entryId={entry.id} kind="material" unitPrice={price.exact} />
          </details>
        </>
      )}
    </>
  )
}

function SampleLine({
  accountId,
  entryId,
  kind,
  unitPrice,
  pricingUnit,
  rate,
}: {
  accountId: string
  entryId: string
  kind: "material" | "labor"
  unitPrice?: string
  pricingUnit?: string
  rate?: string
}) {
  const flat = kind === "labor" && pricingUnit === "flat"
  const [quantity, setQuantity] = useState("1")
  const [total, setTotal] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const request = useRef(0)

  async function calculate() {
    if (pendingRef.current || readHidePricesPreference()) return
    const problem = validateSampleQuantity(flat ? "1" : quantity, flat)
    if (problem) {
      setError(problem)
      setTotal(null)
      return
    }
    const session = await readAccountSession()
    if (!session || session.userId !== accountId) {
      setError("Sign in again to use the price book.")
      return
    }
    const gen = ++request.current
    pendingRef.current = true
    setPending(true)
    setError("")
    try {
      const value =
        kind === "material"
          ? await sampleMaterialLineTotal(session, quantity.trim(), unitPrice || "")
          : await sampleLaborLineTotal(session, pricingUnit || "", rate || "", flat ? "1" : quantity.trim())
      if (request.current !== gen || readHidePricesPreference()) return
      if (!(await accountStill(accountId))) {
        setError("The signed-in account changed. Refresh the price book before trying again.")
        return
      }
      if (request.current !== gen || readHidePricesPreference()) return
      setTotal(value)
    } catch (calcError) {
      if (request.current !== gen) return
      setTotal(null)
      setError(priceBookErrorMessage(calcError))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <div className="section-gap">
      <div className="field">
        <label htmlFor={`sample-qty-${entryId}`}>Sample quantity</label>
        <input
          id={`sample-qty-${entryId}`}
          inputMode="decimal"
          autoComplete="off"
          value={flat ? "1" : quantity}
          disabled={flat || pending}
          onChange={(event) => {
            setQuantity(event.target.value)
            setTotal(null)
          }}
        />
      </div>
      <div className="action-row">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => void calculate()}>
          {pending ? "Calculating..." : "Calculate sample line total"}
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {total && (
        <p>
          Database line total: {readableMoney(total)} <span className="small">exact {total}</span>
        </p>
      )}
    </div>
  )
}
