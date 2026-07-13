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

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    const [usageRes, itemsRes] = await Promise.all([
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
    ])

    setUsage((usageRes.data as UsageRow[]) || [])
    setItems((itemsRes.data as Item[]) || [])
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

                  if (!hidePrices) {
                    total += value
                  }

                  return (
                    <div key={u.id} className="jobs-line">
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

              return (
                <div key={item.id} className="jobs-line">
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
              )
            })}
          </div>
        ))
      )}
    </main>
  )
}
