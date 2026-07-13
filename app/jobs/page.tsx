"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabaseClient"
import { isItemOnHold } from "../../lib/itemHold"
import ItemHoldStatus from "../components/ItemHoldStatus"
import { useHidePrices } from "../components/HidePricesProvider"

type UsageRow = {
  id: string
  item_id: string
  job_name: string | null
  quantity_used: number | null
  used_at: string | null
}

type Item = {
  id: string
  product_name: string | null
  quantity_type: string | null
  quantity_on_hand: number | null
  unit_cost: number | null
  hold_last_name: string | null
  hold_at: string | null
  warehouse_location: string | null
}

type JobsViewMode = "usage" | "holds"

export default function JobsPage() {
  const { hidePrices } = useHidePrices()
  const [viewMode, setViewMode] = useState<JobsViewMode>("usage")
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [search, setSearch] = useState("")
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [undoingUsageId, setUndoingUsageId] = useState<string | null>(null)
  const [releasingHoldItemId, setReleasingHoldItemId] = useState<string | null>(null)

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    const [usageRes, itemsRes] = await Promise.all([
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
    ])

    if (usageRes.error) {
      console.error("[Jobs] inventory_usage load failed:", usageRes.error)
      setErrorMessage(usageRes.error.message)
    }
    if (itemsRes.error) {
      console.error("[Jobs] inventory_items load failed:", itemsRes.error)
      setErrorMessage(itemsRes.error.message)
    }

    setUsage((usageRes.data as UsageRow[]) || [])
    setItems((itemsRes.data as Item[]) || [])
  }

  const undoUsage = async (usageRow: UsageRow) => {
    const confirmed = confirm("Undo this usage and restore the quantity to inventory?")
    if (!confirmed) return

    setUndoingUsageId(usageRow.id)
    setErrorMessage("")
    setMessage("")

    const qty = Number(usageRow.quantity_used || 0)
    const item = items.find((i) => i.id === usageRow.item_id)

    const { error: deleteError } = await supabase
      .from("inventory_usage")
      .delete()
      .eq("id", usageRow.id)

    if (deleteError) {
      setErrorMessage(deleteError.message)
      setUndoingUsageId(null)
      return
    }

    if (item) {
      const newQty = Number(item.quantity_on_hand || 0) + qty
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ quantity_on_hand: newQty })
        .eq("id", usageRow.item_id)

      if (updateError) {
        setErrorMessage(updateError.message)
        setUndoingUsageId(null)
        return
      }

      setItems((prev) =>
        prev.map((inventoryItem) =>
          inventoryItem.id === usageRow.item_id
            ? { ...inventoryItem, quantity_on_hand: newQty }
            : inventoryItem,
        ),
      )
    }

    setUsage((prev) => prev.filter((row) => row.id !== usageRow.id))
    setMessage("Usage undone.")
    setUndoingUsageId(null)
  }

  const releaseItemHold = async (item: Item) => {
    const confirmed = confirm(`Release hold for ${item.product_name || "this item"}?`)
    if (!confirmed) return

    setReleasingHoldItemId(item.id)
    setErrorMessage("")
    setMessage("")

    const { error } = await supabase
      .from("inventory_items")
      .update({
        hold_last_name: null,
        hold_at: null,
      })
      .eq("id", item.id)

    if (error) {
      setErrorMessage(error.message)
      setReleasingHoldItemId(null)
      return
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === item.id
          ? { ...inventoryItem, hold_last_name: null, hold_at: null }
          : inventoryItem,
      ),
    )
    setMessage("Hold released. Item is available to show.")
    setReleasingHoldItemId(null)
  }

  const jobGroups = useMemo(() => {
    const grouped: Record<string, UsageRow[]> = {}

    usage.forEach((u) => {
      const key = u.job_name || "No Job"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(u)
    })

    return Object.entries(grouped)
      .filter(([job]) => job.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [usage, search])

  const holdGroups = useMemo(() => {
    const grouped: Record<string, Item[]> = {}
    const query = search.trim().toLowerCase()

    items
      .filter((item) => isItemOnHold(item.hold_last_name))
      .forEach((item) => {
        const key = item.hold_last_name!.trim()
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(item)
      })

    return Object.entries(grouped)
      .filter(([lastName, heldItems]) => {
        if (!query) return true
        if (lastName.toLowerCase().includes(query)) return true
        return heldItems.some((item) => (item.product_name || "").toLowerCase().includes(query))
      })
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [items, search])

  const searchPlaceholder =
    viewMode === "usage" ? "Search jobs..." : "Search holds by last name or item..."

  return (
    <main>
      <h1>Jobs & Holds</h1>
      <p className="subtext section-gap">
        {viewMode === "usage"
          ? "Review material assigned to jobs from inventory usage."
          : "Review inventory currently on hold for customers."}
      </p>

      {message && <div className="success page-feedback">{message}</div>}
      {errorMessage && <div className="notice page-feedback">{errorMessage}</div>}

      <div className="jobs-toolbar">
        <input
          className="search jobs-search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="toolbar-view-toggle" role="group" aria-label="Jobs page view">
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === "usage" ? "toolbar-view-btn-active" : ""}`}
            onClick={() => setViewMode("usage")}
            aria-pressed={viewMode === "usage"}
          >
            Job Usage
          </button>
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === "holds" ? "toolbar-view-btn-active" : ""}`}
            onClick={() => setViewMode("holds")}
            aria-pressed={viewMode === "holds"}
          >
            On Hold
          </button>
        </div>
      </div>

      {viewMode === "usage" ? (
        jobGroups.length === 0 ? (
          <div className="empty">No usage yet.</div>
        ) : (
          jobGroups.map(([job, entries]) => {
            let total = 0

            return (
              <div key={job} className="card jobs-group-card">
                <h3>{job}</h3>

                {entries.map((u) => {
                  const item = items.find((i) => i.id === u.item_id)
                  const cost = Number(item?.unit_cost || 0)
                  const value = cost * Number(u.quantity_used || 0)
                  const isUndoing = undoingUsageId === u.id

                  if (!hidePrices) {
                    total += value
                  }

                  return (
                    <div key={u.id} className="jobs-line-row">
                      <div className="jobs-line">
                        • {item?.product_name || "Item"} — {u.quantity_used || 0}{" "}
                        {item?.quantity_type || ""}
                        {!hidePrices && <> — ${value.toFixed(0)}</>}
                        {u.used_at && (
                          <span className="jobs-line-meta">
                            {" "}
                            — {new Date(u.used_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-secondary btn-small jobs-undo-btn"
                        disabled={isUndoing}
                        onClick={() => void undoUsage(u)}
                      >
                        {isUndoing ? "Undoing..." : "Undo"}
                      </button>
                    </div>
                  )
                })}

                {!hidePrices && (
                  <div className="jobs-group-total">Total: ${total.toFixed(0)}</div>
                )}
              </div>
            )
          })
        )
      ) : holdGroups.length === 0 ? (
        <div className="empty">No items on hold.</div>
      ) : (
        holdGroups.map(([lastName, heldItems]) => (
          <div key={lastName} className="card jobs-group-card">
            <div className="jobs-group-header">
              <h3>{lastName}</h3>
              <ItemHoldStatus holdLastName={lastName} compact />
            </div>

            {heldItems.map((item) => {
              const cost = Number(item.unit_cost || 0)
              const qty = Number(item.quantity_on_hand || 0)
              const value = cost * qty
              const isReleasing = releasingHoldItemId === item.id

              return (
                <div key={item.id} className="jobs-line-row">
                  <div className="jobs-line">
                    • {item.product_name || "Item"} — {qty} {item.quantity_type || ""}
                    {!hidePrices && <> — ${value.toFixed(0)}</>}
                    {item.warehouse_location && (
                      <span className="jobs-line-meta"> — {item.warehouse_location}</span>
                    )}
                    {item.hold_at && (
                      <span className="jobs-line-meta">
                        {" "}
                        — held since {new Date(item.hold_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-small jobs-undo-btn"
                    disabled={isReleasing}
                    onClick={() => void releaseItemHold(item)}
                  >
                    {isReleasing ? "Releasing..." : "Undo Hold"}
                  </button>
                </div>
              )
            })}
          </div>
        ))
      )}
    </main>
  )
}
