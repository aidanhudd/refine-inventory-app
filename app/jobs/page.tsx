"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabaseClient"
import { isItemOnHold } from "../../lib/itemHold"
import ItemHoldStatus from "../components/ItemHoldStatus"
import { useHidePrices } from "../components/HidePricesProvider"
import { useAuth } from "../components/AuthProvider"
import {
  canManageJobStatus,
  canUndoSharedUsage,
  formatJobWithCustomerLabel,
  resolveUsageJobLabel,
  type Customer,
  type Job,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type UsageRow = {
  id: string
  item_id: string
  user_id: string | null
  job_id: string | null
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

const CUSTOMER_SELECT =
  "id, name, phone, email, address, notes, created_by, created_at, updated_at"
const JOB_SELECT =
  "id, customer_id, name, address, notes, status, created_by, created_at, updated_at, completed_at"

export default function JobsPage() {
  const { hidePrices } = useHidePrices()
  const { user, profile } = useAuth()
  const [viewMode, setViewMode] = useState<JobsViewMode>("usage")
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [jobsById, setJobsById] = useState<Map<string, JobWithCustomer>>(new Map())
  const [search, setSearch] = useState("")
  const [includeCompletedJobs, setIncludeCompletedJobs] = useState(false)
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [undoingUsageId, setUndoingUsageId] = useState<string | null>(null)
  const [releasingHoldItemId, setReleasingHoldItemId] = useState<string | null>(null)
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null)

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    const [usageRes, itemsRes, jobsRes] = await Promise.all([
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
      supabase
        .from("jobs")
        .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
        .order("name", { ascending: true }),
    ])

    if (usageRes.error) {
      console.error("[Jobs] inventory_usage load failed:", usageRes.error)
      setErrorMessage(usageRes.error.message)
    }
    if (itemsRes.error) {
      console.error("[Jobs] inventory_items load failed:", itemsRes.error)
      setErrorMessage(itemsRes.error.message)
    }
    if (jobsRes.error) {
      console.error("[Jobs] jobs load failed:", jobsRes.error)
      // Keep page usable for legacy usage even if jobs table is not migrated yet.
      if (!usageRes.error) {
        setErrorMessage(jobsRes.error.message)
      }
    }

    setUsage((usageRes.data as UsageRow[]) || [])
    setItems((itemsRes.data as Item[]) || [])

    const nextJobs = new Map<string, JobWithCustomer>()
    ;((jobsRes.data as Array<Job & { customer: Customer | Customer[] | null }>) || []).forEach((row) => {
      nextJobs.set(row.id, {
        ...row,
        customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer,
      })
    })
    setJobsById(nextJobs)
  }

  const undoUsage = async (usageRow: UsageRow) => {
    if (undoingUsageId) return

    const allowed = canUndoSharedUsage({
      usageUserId: usageRow.user_id,
      currentUserId: user?.id,
      role: profile?.role,
    })
    if (!allowed) {
      setErrorMessage("You can only undo your own usage records.")
      return
    }

    const confirmed = confirm("Undo this usage and restore the quantity to inventory?")
    if (!confirmed) return

    setUndoingUsageId(usageRow.id)
    setErrorMessage("")
    setMessage("")

    const { data: deletedRows, error: deleteError } = await supabase
      .from("inventory_usage")
      .delete()
      .eq("id", usageRow.id)
      .select("id, item_id, quantity_used")

    if (deleteError) {
      setErrorMessage(deleteError.message)
      setUndoingUsageId(null)
      return
    }

    if (!deletedRows || deletedRows.length !== 1) {
      setErrorMessage("Usage could not be undone. No matching usage row was deleted.")
      setUndoingUsageId(null)
      return
    }

    const deleted = deletedRows[0]
    const restoredItemId = deleted.item_id as string
    const restoredQty = Number(deleted.quantity_used || 0)

    const item = items.find((i) => i.id === restoredItemId)
    if (!item) {
      setErrorMessage("Usage row was deleted, but the inventory item could not be found to restore quantity.")
      setUsage((prev) => prev.filter((row) => row.id !== deleted.id))
      setUndoingUsageId(null)
      return
    }

    const newQty = Number(item.quantity_on_hand || 0) + restoredQty
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity_on_hand: newQty })
      .eq("id", restoredItemId)

    if (updateError) {
      setErrorMessage(updateError.message)
      setUndoingUsageId(null)
      return
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === restoredItemId
          ? { ...inventoryItem, quantity_on_hand: newQty }
          : inventoryItem,
      ),
    )
    setUsage((prev) => prev.filter((row) => row.id !== deleted.id))
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

  const updateJobStatus = async (jobId: string, status: "completed" | "archived" | "active") => {
    if (!canManageJobStatus(profile?.role)) {
      setErrorMessage("Only managers and admins can change job status.")
      return
    }

    setUpdatingJobId(jobId)
    setErrorMessage("")
    setMessage("")

    const { data, error } = await supabase
      .from("jobs")
      .update({ status })
      .eq("id", jobId)
      .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
      .single()

    if (error || !data) {
      setErrorMessage(error?.message || "Failed to update job status.")
      setUpdatingJobId(null)
      return
    }

    const row = data as Job & { customer: Customer | Customer[] | null }
    const updated: JobWithCustomer = {
      ...row,
      customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer,
    }

    setJobsById((prev) => {
      const next = new Map(prev)
      next.set(jobId, updated)
      return next
    })
    setMessage(`Job marked ${status}.`)
    setUpdatingJobId(null)
  }

  const jobGroups = useMemo(() => {
    const grouped: Record<
      string,
      {
        label: string
        jobId: string | null
        jobStatus: string | null
        entries: UsageRow[]
      }
    > = {}

    // Seed structured jobs so zero-usage jobs still appear for status management.
    jobsById.forEach((job) => {
      const key = `job:${job.id}`
      grouped[key] = {
        label: formatJobWithCustomerLabel(job),
        jobId: job.id,
        jobStatus: job.status || null,
        entries: [],
      }
    })

    usage.forEach((u) => {
      const label = resolveUsageJobLabel({
        jobId: u.job_id,
        jobName: u.job_name,
        jobsById,
      })
      const key = u.job_id ? `job:${u.job_id}` : `legacy:${label}`

      if (!grouped[key]) {
        grouped[key] = {
          label,
          jobId: u.job_id,
          jobStatus: u.job_id ? jobsById.get(u.job_id)?.status || null : null,
          entries: [],
        }
      } else if (u.job_id && jobsById.has(u.job_id)) {
        // Prefer live structured label when available.
        grouped[key].label = formatJobWithCustomerLabel(jobsById.get(u.job_id)!)
        grouped[key].jobStatus = jobsById.get(u.job_id)?.status || null
      }
      grouped[key].entries.push(u)
    })

    const query = search.trim().toLowerCase()

    return Object.values(grouped)
      .filter((group) => {
        if (!includeCompletedJobs && group.jobStatus && group.jobStatus !== "active") {
          // Still show legacy groups (no structured status).
          // Hide completed/archived structured jobs unless toggled on.
          if (group.jobId) return false
        }
        if (!query) return true
        if (group.label.toLowerCase().includes(query)) return true
        if (group.jobId) {
          const job = jobsById.get(group.jobId)
          if (job?.name.toLowerCase().includes(query)) return true
          if ((job?.customer?.name || "").toLowerCase().includes(query)) return true
        }
        return false
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [usage, search, jobsById, includeCompletedJobs])

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
    viewMode === "usage" ? "Search customers or jobs..." : "Search holds by last name or item..."
  const canManageJobs = canManageJobStatus(profile?.role)

  return (
    <main>
      <h1>Jobs & Holds</h1>
      <p className="subtext section-gap">
        {viewMode === "usage"
          ? "Review material assigned to jobs from inventory usage across the warehouse team."
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

      {viewMode === "usage" && (
        <label className="jobs-include-completed">
          <input
            type="checkbox"
            checked={includeCompletedJobs}
            onChange={(e) => setIncludeCompletedJobs(e.target.checked)}
          />
          Include completed / archived jobs
        </label>
      )}

      {viewMode === "usage" ? (
        jobGroups.length === 0 ? (
          <div className="empty">No jobs or usage yet.</div>
        ) : (
          jobGroups.map((group) => {
            let total = 0
            const linkedJob = group.jobId ? jobsById.get(group.jobId) : undefined

            return (
              <div key={`${group.jobId || group.label}`} className="card jobs-group-card">
                <div className="jobs-group-header">
                  <h3>{group.label}</h3>
                  {linkedJob?.status && linkedJob.status !== "active" && (
                    <span className="badge">{linkedJob.status}</span>
                  )}
                </div>

                {canManageJobs && linkedJob && (
                  <div className="jobs-status-actions">
                    {linkedJob.status === "active" ? (
                      <>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={updatingJobId === linkedJob.id}
                          onClick={() => void updateJobStatus(linkedJob.id, "completed")}
                        >
                          Mark completed
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={updatingJobId === linkedJob.id}
                          onClick={() => void updateJobStatus(linkedJob.id, "archived")}
                        >
                          Archive
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary btn-small"
                        disabled={updatingJobId === linkedJob.id}
                        onClick={() => void updateJobStatus(linkedJob.id, "active")}
                      >
                        Reopen active
                      </button>
                    )}
                  </div>
                )}

                {group.entries.length === 0 ? (
                  <div className="jobs-line jobs-line-empty">No material usage yet.</div>
                ) : (
                  group.entries.map((u) => {
                    const item = items.find((i) => i.id === u.item_id)
                    const cost = Number(item?.unit_cost || 0)
                    const value = cost * Number(u.quantity_used || 0)
                    const isUndoing = undoingUsageId === u.id
                    const showUndo = canUndoSharedUsage({
                      usageUserId: u.user_id,
                      currentUserId: user?.id,
                      role: profile?.role,
                    })

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
                        {showUndo && (
                          <button
                            type="button"
                            className="btn-secondary btn-small jobs-undo-btn"
                            disabled={!!undoingUsageId}
                            onClick={() => void undoUsage(u)}
                          >
                            {isUndoing ? "Undoing..." : "Undo"}
                          </button>
                        )}
                      </div>
                    )
                  })
                )}

                {!hidePrices && group.entries.length > 0 && (
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
