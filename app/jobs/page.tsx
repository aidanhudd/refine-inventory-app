"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabaseClient"
import { holdJobSublabel, isItemOnHold } from "../../lib/itemHold"
import ItemHoldStatus from "../components/ItemHoldStatus"
import CustomersJobsView from "../components/CustomersJobsView"
import { useHidePrices } from "../components/HidePricesProvider"
import { useAuth } from "../components/AuthProvider"
import {
  CUSTOMER_SELECT,
  loadCustomersOrdered,
  mapJobsWithCustomer,
  releaseItemHoldRpc,
  updateJobStatusRecord,
  JOB_SELECT,
} from "../../lib/customerJobApi"
import {
  canManageJobStatus,
  canUndoSharedUsage,
  formatJobWithCustomerLabel,
  formatPhase2Error,
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
  hold_customer_id: string | null
  hold_job_id: string | null
  warehouse_location: string | null
}

type JobsViewMode = "usage" | "holds" | "customers"

type HoldGroup = {
  key: string
  label: string
  structured: boolean
  items: Item[]
}

export default function JobsPage() {
  const { hidePrices } = useHidePrices()
  const { user, profile } = useAuth()
  const [viewMode, setViewMode] = useState<JobsViewMode>("usage")
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
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
    const [usageRes, itemsRes, jobsRes, customersRes] = await Promise.all([
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
      supabase
        .from("jobs")
        .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
        .order("name", { ascending: true }),
      loadCustomersOrdered(),
    ])

    if (usageRes.error) {
      console.error("[Jobs] inventory_usage load failed:", usageRes.error)
      setErrorMessage(formatPhase2Error(usageRes.error.message))
    }
    if (itemsRes.error) {
      console.error("[Jobs] inventory_items load failed:", itemsRes.error)
      setErrorMessage(formatPhase2Error(itemsRes.error.message))
    }
    if (jobsRes.error) {
      console.error("[Jobs] jobs load failed:", jobsRes.error)
      if (!usageRes.error) setErrorMessage(formatPhase2Error(jobsRes.error.message))
    }
    if (customersRes.error) {
      console.error("[Jobs] customers load failed:", customersRes.error)
      setErrorMessage(customersRes.error)
    }

    setUsage((usageRes.data as UsageRow[]) || [])
    setItems(
      ((itemsRes.data as Item[]) || []).map((item) => ({
        ...item,
        hold_customer_id: item.hold_customer_id ?? null,
        hold_job_id: item.hold_job_id ?? null,
      })),
    )
    setCustomers(customersRes.data)

    const nextJobs = new Map<string, JobWithCustomer>()
    mapJobsWithCustomer(
      (jobsRes.data as Array<Job & { customer: Customer | Customer[] | null }>) || [],
    ).forEach((job) => nextJobs.set(job.id, job))
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
      setErrorMessage(formatPhase2Error(deleteError.message))
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
      setErrorMessage(formatPhase2Error(updateError.message))
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

    const { id, error } = await releaseItemHoldRpc(item.id)
    if (error || !id) {
      setErrorMessage(error || "Failed to release hold.")
      setReleasingHoldItemId(null)
      return
    }

    setItems((prev) =>
      prev.map((inventoryItem) =>
        inventoryItem.id === item.id
          ? {
              ...inventoryItem,
              hold_last_name: null,
              hold_at: null,
              hold_customer_id: null,
              hold_job_id: null,
            }
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

    const result = await updateJobStatusRecord(jobId, status)
    if (result.error || !result.data) {
      setErrorMessage(result.error || "Failed to update job status.")
      setUpdatingJobId(null)
      return
    }

    setJobsById((prev) => {
      const next = new Map(prev)
      next.set(jobId, result.data!)
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
        grouped[key].label = formatJobWithCustomerLabel(jobsById.get(u.job_id)!)
        grouped[key].jobStatus = jobsById.get(u.job_id)?.status || null
      }
      grouped[key].entries.push(u)
    })

    const query = search.trim().toLowerCase()

    return Object.values(grouped)
      .filter((group) => {
        if (!includeCompletedJobs && group.jobStatus && group.jobStatus !== "active") {
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
    const customersById = new Map(customers.map((c) => [c.id, c]))
    const grouped = new Map<string, HoldGroup>()
    const query = search.trim().toLowerCase()

    items
      .filter((item) => isItemOnHold(item.hold_last_name, item.hold_customer_id, item.hold_job_id))
      .forEach((item) => {
        if (item.hold_customer_id) {
          const customer = customersById.get(item.hold_customer_id)
          const label = customer?.name || (item.hold_last_name || "").split(" — ")[0] || "Customer"
          const key = `customer:${item.hold_customer_id}`
          const existing = grouped.get(key)
          if (existing) existing.items.push(item)
          else grouped.set(key, { key, label, structured: true, items: [item] })
        } else {
          const label = (item.hold_last_name || "On hold").trim()
          const key = `legacy:${label.toLowerCase()}`
          const existing = grouped.get(key)
          if (existing) existing.items.push(item)
          else grouped.set(key, { key, label, structured: false, items: [item] })
        }
      })

    return Array.from(grouped.values())
      .filter((group) => {
        if (!query) return true
        if (group.label.toLowerCase().includes(query)) return true
        return group.items.some((item) => {
          if ((item.product_name || "").toLowerCase().includes(query)) return true
          if ((item.hold_last_name || "").toLowerCase().includes(query)) return true
          const job = item.hold_job_id ? jobsById.get(item.hold_job_id) : null
          return !!(job && job.name.toLowerCase().includes(query))
        })
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [items, search, customers, jobsById])

  const searchPlaceholder =
    viewMode === "usage"
      ? "Search customers or jobs..."
      : viewMode === "holds"
        ? "Search holds by customer, job, or item..."
        : "Search customers or jobs..."

  const canManageJobs = canManageJobStatus(profile?.role)

  const subtext =
    viewMode === "usage"
      ? "Review material assigned to jobs from inventory usage across the warehouse team."
      : viewMode === "holds"
        ? "Review inventory currently on hold for customers."
        : "Manage customers and jobs, including archive, reopen, and unused deletion."

  return (
    <main>
      <h1>Jobs & Holds</h1>
      <p className="subtext section-gap">{subtext}</p>

      {message && <div className="success page-feedback">{message}</div>}
      {errorMessage && <div className="notice page-feedback">{errorMessage}</div>}

      <div className="jobs-toolbar">
        {viewMode !== "customers" && (
          <input
            className="search jobs-search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}

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
          <button
            type="button"
            className={`toolbar-view-btn ${viewMode === "customers" ? "toolbar-view-btn-active" : ""}`}
            onClick={() => setViewMode("customers")}
            aria-pressed={viewMode === "customers"}
          >
            Customers & Jobs
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

      {viewMode === "customers" ? (
        <CustomersJobsView
          customers={customers}
          jobsById={jobsById}
          usage={usage}
          items={items}
          role={profile?.role}
          onCustomersChange={setCustomers}
          onJobUpsert={(job) => {
            setJobsById((prev) => {
              const next = new Map(prev)
              next.set(job.id, job)
              return next
            })
          }}
          onJobRemove={(jobId) => {
            setJobsById((prev) => {
              const next = new Map(prev)
              next.delete(jobId)
              return next
            })
          }}
          onMessage={setMessage}
          onError={setErrorMessage}
        />
      ) : viewMode === "usage" ? (
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

                    if (!hidePrices) total += value

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
        holdGroups.map((group) => (
          <div key={group.key} className="card jobs-group-card">
            <div className="jobs-group-header">
              <h3>{group.label}</h3>
              <ItemHoldStatus holdLastName={group.label} compact />
            </div>

            {group.items.map((item) => {
              const cost = Number(item.unit_cost || 0)
              const qty = Number(item.quantity_on_hand || 0)
              const value = cost * qty
              const isReleasing = releasingHoldItemId === item.id
              const job = item.hold_job_id ? jobsById.get(item.hold_job_id) : null
              const sublabel = group.structured
                ? holdJobSublabel({ holdLastName: item.hold_last_name, jobName: job?.name })
                : null

              return (
                <div key={item.id} className="jobs-line-row">
                  <div className="jobs-line">
                    • {item.product_name || "Item"} — {qty} {item.quantity_type || ""}
                    {sublabel && <span className="jobs-line-meta"> — {sublabel}</span>}
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
