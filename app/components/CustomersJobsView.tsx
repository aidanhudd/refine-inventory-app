"use client"

import { FormEvent, useMemo, useState, type ReactNode } from "react"
import NewCustomerForm from "./NewCustomerForm"
import NewJobForm from "./NewJobForm"
import {
  archiveCustomerRpc,
  deleteUnusedCustomerRpc,
  deleteUnusedJobRpc,
  reopenCustomerRpc,
  updateCustomerRecord,
  updateJobRecord,
  updateJobStatusRecord,
} from "../../lib/customerJobApi"
import {
  canEditCustomerOrJob,
  canManageCustomers,
  canManageJobStatus,
  formatJobWithCustomerLabel,
  isCustomerActive,
  type Customer,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type UsageRow = {
  id: string
  item_id: string
  job_id: string | null
  job_name: string | null
  quantity_used: number | null
  used_at: string | null
}

type Item = {
  id: string
  product_name: string | null
  quantity_type: string | null
  hold_last_name: string | null
  hold_customer_id?: string | null
}

type CustomersJobsViewProps = {
  customers: Customer[]
  jobsById: Map<string, JobWithCustomer>
  usage: UsageRow[]
  items: Item[]
  currentUserId: string | null | undefined
  role: string | null | undefined
  navToggle?: ReactNode
  onCustomersChange: (customers: Customer[]) => void
  onJobUpsert: (job: JobWithCustomer) => void
  onJobRemove: (jobId: string) => void
  onMessage: (message: string) => void
  onError: (message: string) => void
}

type CreatePanel = "none" | "customer" | "job" | "job-for"

export default function CustomersJobsView({
  customers,
  jobsById,
  usage,
  items,
  currentUserId,
  role,
  navToggle,
  onCustomersChange,
  onJobUpsert,
  onJobRemove,
  onMessage,
  onError,
}: CustomersJobsViewProps) {
  const canManage = canManageCustomers(role)
  const canManageJobs = canManageJobStatus(role)
  const [search, setSearch] = useState("")
  const [includeArchived, setIncludeArchived] = useState(false)
  const [includeCompletedJobs, setIncludeCompletedJobs] = useState(false)
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(() => new Set())
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [createPanel, setCreatePanel] = useState<CreatePanel>("none")
  const [createJobForCustomerId, setCreateJobForCustomerId] = useState<string | null>(null)
  const [createFlowSession, setCreateFlowSession] = useState(0)
  const [creatingCustomerFromJob, setCreatingCustomerFromJob] = useState(false)
  const [createSubmitting, setCreateSubmitting] = useState(false)

  const [selectedCreateCustomer, setSelectedCreateCustomer] = useState<Customer | null>(null)
  const [createCustomerQuery, setCreateCustomerQuery] = useState("")
  const [showCreateCustomerResults, setShowCreateCustomerResults] = useState(false)

  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [editingJobId, setEditingJobId] = useState<string | null>(null)

  const [customerForm, setCustomerForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  })
  const [jobForm, setJobForm] = useState({ name: "", address: "", notes: "" })

  const jobsList = useMemo(() => Array.from(jobsById.values()), [jobsById])

  const jobsByCustomer = useMemo(() => {
    const map = new Map<string, JobWithCustomer[]>()
    jobsById.forEach((job) => {
      const list = map.get(job.customer_id) || []
      list.push(job)
      map.set(job.customer_id, list)
    })
    map.forEach((list, key) => {
      map.set(
        key,
        list.sort((a, b) => a.name.localeCompare(b.name)),
      )
    })
    return map
  }, [jobsById])

  const visibleCustomers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers
      .filter((customer) => includeArchived || isCustomerActive(customer))
      .filter((customer) => {
        if (!q) return true
        if (customer.name.toLowerCase().includes(q)) return true
        if ((customer.phone || "").toLowerCase().includes(q)) return true
        const jobs = jobsByCustomer.get(customer.id) || []
        return jobs.some(
          (job) =>
            job.name.toLowerCase().includes(q) ||
            formatJobWithCustomerLabel(job).toLowerCase().includes(q),
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [customers, includeArchived, search, jobsByCustomer])

  const canEditRecord = (createdBy: string | null | undefined) =>
    canEditCustomerOrJob({ createdBy, currentUserId, role })

  const toggleExpanded = (customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev)
      if (next.has(customerId)) next.delete(customerId)
      else next.add(customerId)
      return next
    })
  }

  const closeCreatePanels = () => {
    setCreatePanel("none")
    setCreateJobForCustomerId(null)
    setCreatingCustomerFromJob(false)
    setCreateSubmitting(false)
    setSelectedCreateCustomer(null)
    setCreateCustomerQuery("")
    setShowCreateCustomerResults(false)
  }

  const startAddCustomer = () => {
    closeCreatePanels()
    setEditingCustomerId(null)
    setEditingJobId(null)
    setCreateFlowSession((v) => v + 1)
    setCreatePanel("customer")
  }

  const startAddJob = () => {
    closeCreatePanels()
    setEditingCustomerId(null)
    setEditingJobId(null)
    setCreateFlowSession((v) => v + 1)
    setCreatePanel("job")
  }

  const startAddJobFor = (customer: Customer) => {
    closeCreatePanels()
    setEditingCustomerId(null)
    setEditingJobId(null)
    setSelectedCreateCustomer(customer)
    setCreateCustomerQuery(customer.name)
    setCreateJobForCustomerId(customer.id)
    setExpandedCustomerIds((prev) => new Set(prev).add(customer.id))
    setCreateFlowSession((v) => v + 1)
    setCreatePanel("job-for")
  }

  const startEditCustomer = (customer: Customer) => {
    if (!canEditRecord(customer.created_by)) return
    closeCreatePanels()
    setEditingCustomerId(customer.id)
    setCustomerForm({
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      notes: customer.notes || "",
    })
  }

  const startEditJob = (job: JobWithCustomer) => {
    if (!canEditRecord(job.created_by)) return
    closeCreatePanels()
    setEditingJobId(job.id)
    setJobForm({
      name: job.name,
      address: job.address || "",
      notes: job.notes || "",
    })
  }

  const saveCustomer = async (e: FormEvent, customerId: string) => {
    e.preventDefault()
    if (busyKey) return
    const existing = customers.find((c) => c.id === customerId)
    if (!existing || !canEditRecord(existing.created_by)) {
      onError("You can only edit customers you created.")
      return
    }
    if (!customerForm.name.trim()) {
      onError("Customer name is required.")
      return
    }
    setBusyKey(`edit-customer-${customerId}`)
    onError("")

    const result = await updateCustomerRecord(customerId, customerForm)
    setBusyKey(null)
    if (result.error || !result.data) {
      onError(result.error || "Failed to save customer.")
      return
    }

    onCustomersChange(customers.map((c) => (c.id === customerId ? result.data! : c)))
    setEditingCustomerId(null)
    onMessage("Customer updated.")
  }

  const saveJob = async (e: FormEvent, customerId: string, jobId: string) => {
    e.preventDefault()
    if (busyKey) return
    const existing = jobsById.get(jobId)
    if (!existing || !canEditRecord(existing.created_by)) {
      onError("You can only edit jobs you created.")
      return
    }
    if (!jobForm.name.trim()) {
      onError("Job name is required.")
      return
    }
    setBusyKey(`edit-job-${jobId}`)
    onError("")

    const result = await updateJobRecord(jobId, jobForm)
    setBusyKey(null)
    if (result.error || !result.data) {
      onError(result.error || "Failed to update job.")
      return
    }
    onJobUpsert({
      ...result.data,
      customer: existing.customer || customers.find((c) => c.id === customerId) || null,
    })
    setEditingJobId(null)
    onMessage("Job updated.")
  }

  const runJobStatus = async (jobId: string, status: "active" | "completed" | "archived") => {
    if (!canManageJobs || busyKey) return
    setBusyKey(`status-${jobId}`)
    onError("")
    const result = await updateJobStatusRecord(jobId, status)
    setBusyKey(null)
    if (result.error || !result.data) {
      onError(result.error || "Failed to update job status.")
      return
    }
    onJobUpsert(result.data)
    onMessage(`Job marked ${status}.`)
  }

  const runArchiveCustomer = async (customerId: string) => {
    if (!canManage || busyKey) return
    setBusyKey(`archive-${customerId}`)
    onError("")
    const { id, error } = await archiveCustomerRpc(customerId)
    setBusyKey(null)
    if (error || !id) {
      onError(error || "Failed to archive customer.")
      return
    }
    onCustomersChange(
      customers.map((c) =>
        c.id === customerId ? { ...c, status: "archived", archived_at: new Date().toISOString() } : c,
      ),
    )
    onMessage("Customer archived.")
  }

  const runReopenCustomer = async (customerId: string) => {
    if (!canManage || busyKey) return
    setBusyKey(`reopen-${customerId}`)
    onError("")
    const { id, error } = await reopenCustomerRpc(customerId)
    setBusyKey(null)
    if (error || !id) {
      onError(error || "Failed to reopen customer.")
      return
    }
    onCustomersChange(
      customers.map((c) => (c.id === customerId ? { ...c, status: "active", archived_at: null } : c)),
    )
    onMessage("Customer reopened.")
  }

  const runDeleteJob = async (job: JobWithCustomer) => {
    if (!canManage || busyKey) return
    const confirmed = confirm(`Permanently delete unused job "${job.name}"?`)
    if (!confirmed) return
    setBusyKey(`delete-job-${job.id}`)
    onError("")
    const { id, error } = await deleteUnusedJobRpc(job.id)
    setBusyKey(null)
    if (error || !id) {
      onError(error || "Failed to delete job.")
      return
    }
    onJobRemove(job.id)
    onMessage("Job deleted.")
  }

  const runDeleteCustomer = async (customer: Customer) => {
    if (!canManage || busyKey) return
    const exactLegacyHold = items.some(
      (item) =>
        !item.hold_customer_id &&
        (item.hold_last_name || "").trim().toLowerCase() === customer.name.trim().toLowerCase(),
    )
    if (exactLegacyHold) {
      const proceed = confirm(
        `Warning: a legacy free-text hold matches "${customer.name}" exactly. Legacy holds do not block deletion. Delete unused customer anyway?`,
      )
      if (!proceed) return
    } else {
      const confirmed = confirm(`Permanently delete unused customer "${customer.name}"?`)
      if (!confirmed) return
    }

    setBusyKey(`delete-customer-${customer.id}`)
    onError("")
    const { id, error } = await deleteUnusedCustomerRpc(customer.id)
    setBusyKey(null)
    if (error || !id) {
      onError(error || "Failed to delete customer.")
      return
    }
    onCustomersChange(customers.filter((c) => c.id !== customer.id))
    onMessage("Customer deleted.")
  }

  const handleSelectExistingCustomer = (customer: Customer, context: "add-customer" | "add-job") => {
    if (!isCustomerActive(customer)) {
      setIncludeArchived(true)
      setExpandedCustomerIds((prev) => new Set(prev).add(customer.id))
      if (context === "add-job") {
        setCreatingCustomerFromJob(false)
      } else {
        closeCreatePanels()
      }
      onError(
        `"${customer.name}" is archived. A manager must reopen it before it can be used for new jobs.`,
      )
      return
    }

    if (context === "add-customer") {
      setExpandedCustomerIds((prev) => new Set(prev).add(customer.id))
      closeCreatePanels()
      onMessage(`Selected existing customer ${customer.name}.`)
      return
    }

    setSelectedCreateCustomer(customer)
    setCreateCustomerQuery(customer.name)
    setShowCreateCustomerResults(false)
    setCreatingCustomerFromJob(false)
  }

  const usageForJob = (jobId: string) => usage.filter((u) => u.job_id === jobId)

  const handleJobCreated = (job: JobWithCustomer) => {
    onJobUpsert(job)
    if (job.customer && !customers.some((c) => c.id === job.customer!.id)) {
      onCustomersChange([...customers, job.customer].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setExpandedCustomerIds((prev) => new Set(prev).add(job.customer_id))
    closeCreatePanels()
    onMessage("Job created.")
  }

  const showTopLevelJobCreate = createPanel === "job"
  const activeCustomersForCreate = customers.filter((c) => isCustomerActive(c))

  const renderJobCreateForm = (title: string) => (
    <div className={createPanel === "job" ? "card jobs-group-card" : "customers-jobs-edit-form"}>
      {createPanel === "job" && <h3>{title}</h3>}
      {createPanel === "job-for" && <h4>{title}</h4>}
      <NewJobForm
        key={createFlowSession}
        hidden={creatingCustomerFromJob}
        customers={activeCustomersForCreate}
        jobs={jobsList}
        selectedCustomer={selectedCreateCustomer}
        onSelectCustomer={setSelectedCreateCustomer}
        customerQuery={createCustomerQuery}
        onCustomerQueryChange={setCreateCustomerQuery}
        showCustomerResults={showCreateCustomerResults}
        onShowCustomerResults={setShowCreateCustomerResults}
        submitting={createSubmitting}
        onSubmittingChange={setCreateSubmitting}
        onCancel={closeCreatePanels}
        onCreated={handleJobCreated}
        onSelectExistingJob={(job) => {
          onJobUpsert(job)
          setExpandedCustomerIds((prev) => new Set(prev).add(job.customer_id))
          closeCreatePanels()
          onMessage(`Selected existing job ${formatJobWithCustomerLabel(job)}.`)
        }}
        onRequestCreateCustomer={() => {
          onError("")
          setCreatingCustomerFromJob(true)
        }}
        onError={onError}
        submitLabel="Create Job"
      />
      {creatingCustomerFromJob && (
        <NewCustomerForm
          customers={customers}
          submitting={createSubmitting}
          onSubmittingChange={setCreateSubmitting}
          onCancel={() => setCreatingCustomerFromJob(false)}
          onCreated={(customer) => {
            onCustomersChange([...customers, customer].sort((a, b) => a.name.localeCompare(b.name)))
            setSelectedCreateCustomer(customer)
            setCreateCustomerQuery(customer.name)
            setShowCreateCustomerResults(false)
            setCreatingCustomerFromJob(false)
          }}
          onSelectExisting={(customer) => {
            handleSelectExistingCustomer(customer, "add-job")
          }}
          onError={onError}
        />
      )}
    </div>
  )

  return (
    <div className="customers-jobs-view">
      <div className="jobs-toolbar">
        <input
          className="search jobs-search"
          placeholder="Search customers or jobs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {navToggle}
        <div className="customers-jobs-toolbar-actions">
          <button type="button" className="btn-secondary btn-small" onClick={startAddCustomer}>
            + Add Customer
          </button>
          <button type="button" className="btn-secondary btn-small" onClick={startAddJob}>
            + Add Job
          </button>
        </div>
      </div>

      <div className="customers-jobs-filters">
        <label className="jobs-include-completed">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived customers
        </label>
        <label className="jobs-include-completed">
          <input
            type="checkbox"
            checked={includeCompletedJobs}
            onChange={(e) => setIncludeCompletedJobs(e.target.checked)}
          />
          Include completed / archived jobs
        </label>
      </div>

      {createPanel === "customer" && (
        <div className="card jobs-group-card">
          <h3>New Customer</h3>
          <NewCustomerForm
            key={createFlowSession}
            customers={customers}
            submitting={createSubmitting}
            onSubmittingChange={setCreateSubmitting}
            onCancel={closeCreatePanels}
            onCreated={(customer) => {
              onCustomersChange([...customers, customer].sort((a, b) => a.name.localeCompare(b.name)))
              setExpandedCustomerIds((prev) => new Set(prev).add(customer.id))
              closeCreatePanels()
              onMessage("Customer created.")
            }}
            onSelectExisting={(customer) => {
              handleSelectExistingCustomer(customer, "add-customer")
            }}
            onError={onError}
          />
        </div>
      )}

      {showTopLevelJobCreate &&
        renderJobCreateForm(
          selectedCreateCustomer ? `New Job for ${selectedCreateCustomer.name}` : "New Job",
        )}

      {visibleCustomers.length === 0 ? (
        <div className="empty">No customers yet.</div>
      ) : (
        visibleCustomers.map((customer) => {
          const expanded = expandedCustomerIds.has(customer.id)
          const jobs = (jobsByCustomer.get(customer.id) || []).filter((job) => {
            if (includeCompletedJobs) return true
            return (job.status || "").toLowerCase() === "active"
          })
          const active = isCustomerActive(customer)
          const canEditCustomer = canEditRecord(customer.created_by)

          return (
            <div key={customer.id} className="card jobs-group-card">
              <div className="jobs-group-header customers-jobs-customer-header">
                <button
                  type="button"
                  className="customers-jobs-expand"
                  onClick={() => toggleExpanded(customer.id)}
                  aria-expanded={expanded}
                >
                  <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                  <h3>
                    {customer.name}
                    {!active && <span className="badge">archived</span>}
                  </h3>
                </button>
                {canEditCustomer && (
                  <div className="customers-jobs-header-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-small"
                      onClick={() => startEditCustomer(customer)}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>

              {(customer.phone || customer.email || customer.address) && (
                <div className="small customers-jobs-contact">
                  {[customer.phone, customer.email, customer.address].filter(Boolean).join(" · ")}
                </div>
              )}

              {editingCustomerId === customer.id && canEditCustomer && (
                <form className="customers-jobs-edit-form" onSubmit={(e) => void saveCustomer(e, customer.id)}>
                  <CustomerFieldsForm form={customerForm} setForm={setCustomerForm} disabled={!!busyKey} />
                  <div className="modal-actions">
                    <button type="button" onClick={() => setEditingCustomerId(null)} disabled={!!busyKey}>
                      Cancel
                    </button>
                    <button type="submit" className="btn-primary" disabled={!!busyKey}>
                      {busyKey === `edit-customer-${customer.id}` ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              )}

              {expanded && (
                <div className="customers-jobs-expanded">
                  <strong>Jobs</strong>
                  {jobs.length === 0 ? (
                    <div className="jobs-line-empty">No jobs to show.</div>
                  ) : (
                    jobs.map((job) => {
                      const lines = usageForJob(job.id)
                      const canEditJob = canEditRecord(job.created_by)
                      return (
                        <div key={job.id} className="customers-jobs-job-block">
                          <div className="jobs-line-row">
                            <div className="jobs-line">
                              • {job.name}{" "}
                              <span className="badge">{job.status}</span>
                            </div>
                            {canEditJob && (
                              <button
                                type="button"
                                className="btn-secondary btn-small jobs-undo-btn"
                                disabled={!!busyKey}
                                onClick={() => startEditJob(job)}
                              >
                                Edit
                              </button>
                            )}
                          </div>

                          {canManageJobs && (
                            <div className="jobs-status-actions">
                              {(job.status || "") === "active" ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-small"
                                    disabled={!!busyKey}
                                    onClick={() => void runJobStatus(job.id, "completed")}
                                  >
                                    Complete
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-small"
                                    disabled={!!busyKey}
                                    onClick={() => void runJobStatus(job.id, "archived")}
                                  >
                                    Archive
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-secondary btn-small"
                                  disabled={!!busyKey}
                                  onClick={() => void runJobStatus(job.id, "active")}
                                >
                                  Reopen
                                </button>
                              )}
                              {canManage && (
                                <button
                                  type="button"
                                  className="btn-danger btn-small"
                                  disabled={!!busyKey}
                                  onClick={() => void runDeleteJob(job)}
                                >
                                  Delete unused
                                </button>
                              )}
                            </div>
                          )}

                          {editingJobId === job.id && canEditJob && (
                            <form
                              className="customers-jobs-edit-form"
                              onSubmit={(e) => void saveJob(e, customer.id, job.id)}
                            >
                              <JobFieldsForm form={jobForm} setForm={setJobForm} disabled={!!busyKey} />
                              <div className="modal-actions">
                                <button type="button" onClick={() => setEditingJobId(null)} disabled={!!busyKey}>
                                  Cancel
                                </button>
                                <button type="submit" className="btn-primary" disabled={!!busyKey}>
                                  Save job
                                </button>
                              </div>
                            </form>
                          )}

                          <div className="small">Material usage</div>
                          {lines.length === 0 ? (
                            <div className="jobs-line-empty">No material usage yet.</div>
                          ) : (
                            lines.map((u) => {
                              const item = items.find((i) => i.id === u.item_id)
                              return (
                                <div key={u.id} className="jobs-line">
                                  • {item?.product_name || "Item"} — {u.quantity_used || 0}{" "}
                                  {item?.quantity_type || ""}
                                  {u.used_at && (
                                    <span className="jobs-line-meta">
                                      {" "}
                                      — {new Date(u.used_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )
                    })
                  )}

                  {active && createPanel === "job-for" && createJobForCustomerId === customer.id
                    ? renderJobCreateForm(`New Job for ${customer.name}`)
                    : active
                      ? (
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          onClick={() => startAddJobFor(customer)}
                        >
                          + Add Job for {customer.name}
                        </button>
                      )
                      : null}

                  {canManage && (
                    <div className="jobs-status-actions" style={{ marginTop: 12 }}>
                      {active ? (
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={!!busyKey}
                          onClick={() => void runArchiveCustomer(customer.id)}
                        >
                          Archive Customer
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={!!busyKey}
                          onClick={() => void runReopenCustomer(customer.id)}
                        >
                          Reopen Customer
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-danger btn-small"
                        disabled={!!busyKey}
                        onClick={() => void runDeleteCustomer(customer)}
                      >
                        Delete unused customer
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function CustomerFieldsForm({
  form,
  setForm,
  disabled,
}: {
  form: { name: string; phone: string; email: string; address: string; notes: string }
  setForm: (value: { name: string; phone: string; email: string; address: string; notes: string }) => void
  disabled: boolean
}) {
  return (
    <div className="job-flow-body">
      <label className="job-flow-label">Name</label>
      <input
        className="job-flow-input"
        value={form.name}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      <label className="job-flow-label">Phone</label>
      <input
        className="job-flow-input"
        value={form.phone}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
      />
      <label className="job-flow-label">Email</label>
      <input
        className="job-flow-input"
        type="email"
        value={form.email}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <label className="job-flow-label">Address</label>
      <input
        className="job-flow-input"
        value={form.address}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <label className="job-flow-label">Notes</label>
      <textarea
        className="job-flow-textarea"
        rows={2}
        value={form.notes}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />
    </div>
  )
}

function JobFieldsForm({
  form,
  setForm,
  disabled,
}: {
  form: { name: string; address: string; notes: string }
  setForm: (value: { name: string; address: string; notes: string }) => void
  disabled: boolean
}) {
  return (
    <div className="job-flow-body">
      <label className="job-flow-label">Job name</label>
      <input
        className="job-flow-input"
        value={form.name}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
      />
      <label className="job-flow-label">Address</label>
      <input
        className="job-flow-input"
        value={form.address}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <label className="job-flow-label">Notes</label>
      <textarea
        className="job-flow-textarea"
        rows={2}
        value={form.notes}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
      />
    </div>
  )
}
