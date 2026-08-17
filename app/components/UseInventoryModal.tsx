"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabaseClient"
import {
  findSimilarCustomers,
  findSimilarJobsForCustomer,
  formatJobLabel,
  formatJobWithCustomerLabel,
  jobMatchesSearch,
  type Customer,
  type Job,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type UseInventoryModalProps = {
  itemName: string | null
  onClose: () => void
  onConfirm: (payload: { quantity: number; jobId: string; jobLabel: string }) => Promise<void>
}

type FlowStep = "use" | "new-job" | "new-customer"

const CUSTOMER_SELECT =
  "id, name, phone, email, address, notes, created_by, created_at, updated_at"
const JOB_SELECT =
  "id, customer_id, name, address, notes, status, created_by, created_at, updated_at, completed_at"

export default function UseInventoryModal({ itemName, onClose, onConfirm }: UseInventoryModalProps) {
  const [step, setStep] = useState<FlowStep>("use")
  const [quantity, setQuantity] = useState("")
  const [jobQuery, setJobQuery] = useState("")
  const [customerQuery, setCustomerQuery] = useState("")
  const [jobs, setJobs] = useState<JobWithCustomer[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedJob, setSelectedJob] = useState<JobWithCustomer | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showJobResults, setShowJobResults] = useState(false)
  const [showCustomerResults, setShowCustomerResults] = useState(false)
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [jobNotes, setJobNotes] = useState("")
  const [acknowledgeJobDuplicate, setAcknowledgeJobDuplicate] = useState(false)

  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [customerNotes, setCustomerNotes] = useState("")
  const [acknowledgeCustomerDuplicate, setAcknowledgeCustomerDuplicate] = useState(false)

  useEffect(() => {
    void loadCustomersAndJobs()
  }, [])

  const loadCustomersAndJobs = async () => {
    setLoadingJobs(true)
    setLoadError("")

    const [customersRes, jobsRes] = await Promise.all([
      supabase.from("customers").select(CUSTOMER_SELECT).order("name", { ascending: true }),
      supabase
        .from("jobs")
        .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
        .eq("status", "active")
        .order("name", { ascending: true }),
    ])

    if (customersRes.error) {
      setLoadError(customersRes.error.message)
      setLoadingJobs(false)
      return
    }
    if (jobsRes.error) {
      setLoadError(jobsRes.error.message)
      setLoadingJobs(false)
      return
    }

    const loadedCustomers = (customersRes.data as Customer[]) || []
    const loadedJobs = ((jobsRes.data as Array<Job & { customer: Customer | Customer[] | null }>) || []).map(
      (row) => ({
        ...row,
        customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer,
      }),
    )

    setCustomers(loadedCustomers)
    setJobs(loadedJobs)
    setLoadingJobs(false)
  }

  const filteredJobs = useMemo(
    () => jobs.filter((job) => jobMatchesSearch(job, jobQuery)).slice(0, 40),
    [jobs, jobQuery],
  )

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 40)
    return customers
      .filter((customer) => customer.name.toLowerCase().includes(q))
      .slice(0, 40)
  }, [customers, customerQuery])

  const similarCustomers = useMemo(
    () => findSimilarCustomers(customers, customerName),
    [customers, customerName],
  )

  const similarJobs = useMemo(
    () =>
      selectedCustomer
        ? findSimilarJobsForCustomer(
            jobs.map(({ customer: _customer, ...job }) => job),
            selectedCustomer.id,
            jobName,
          )
        : [],
    [jobs, selectedCustomer, jobName],
  )

  const selectJob = (job: JobWithCustomer) => {
    setSelectedJob(job)
    setJobQuery(formatJobWithCustomerLabel(job))
    setShowJobResults(false)
    setFormError("")
  }

  const openNewJob = () => {
    setFormError("")
    setJobName("")
    setJobAddress("")
    setJobNotes("")
    setAcknowledgeJobDuplicate(false)
    setSelectedCustomer(null)
    setCustomerQuery("")
    setShowCustomerResults(false)
    setStep("new-job")
  }

  const openNewCustomer = () => {
    setFormError("")
    setCustomerName("")
    setCustomerPhone("")
    setCustomerEmail("")
    setCustomerAddress("")
    setCustomerNotes("")
    setAcknowledgeCustomerDuplicate(false)
    setStep("new-customer")
  }

  const handleCreateCustomer = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return

    const trimmedName = customerName.trim()
    if (!trimmedName) {
      setFormError("Customer name is required.")
      return
    }

    if (similarCustomers.length > 0 && !acknowledgeCustomerDuplicate) {
      setFormError("Possible duplicate customer found. Confirm to continue, or pick an existing customer.")
      return
    }

    setSubmitting(true)
    setFormError("")

    const { data, error } = await supabase
      .from("customers")
      .insert({
        name: trimmedName,
        phone: customerPhone.trim() || null,
        email: customerEmail.trim() || null,
        address: customerAddress.trim() || null,
        notes: customerNotes.trim() || null,
      })
      .select(CUSTOMER_SELECT)
      .single()

    setSubmitting(false)

    if (error || !data) {
      setFormError(error?.message || "Failed to create customer.")
      return
    }

    const created = data as Customer
    setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedCustomer(created)
    setCustomerQuery(created.name)
    setShowCustomerResults(false)
    setStep("new-job")
  }

  const handleCreateJob = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return

    if (!selectedCustomer) {
      setFormError("Select or create a customer.")
      return
    }

    const trimmedName = jobName.trim()
    if (!trimmedName) {
      setFormError("Job name is required.")
      return
    }

    if (similarJobs.length > 0 && !acknowledgeJobDuplicate) {
      setFormError("Possible duplicate job found for this customer. Confirm to continue, or pick the existing job.")
      return
    }

    setSubmitting(true)
    setFormError("")

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        customer_id: selectedCustomer.id,
        name: trimmedName,
        address: jobAddress.trim() || null,
        notes: jobNotes.trim() || null,
        status: "active",
      })
      .select(JOB_SELECT)
      .single()

    setSubmitting(false)

    if (error || !data) {
      setFormError(error?.message || "Failed to create job.")
      return
    }

    const createdJob: JobWithCustomer = {
      ...(data as Job),
      customer: selectedCustomer,
    }

    setJobs((prev) => [...prev, createdJob].sort((a, b) => a.name.localeCompare(b.name)))
    selectJob(createdJob)
    setStep("use")
  }

  const handleConfirmUse = async () => {
    if (submitting) return

    const qty = Number(quantity)
    if (!qty || qty <= 0) {
      setFormError("Enter a valid quantity.")
      return
    }
    if (!selectedJob) {
      setFormError("Select a job.")
      return
    }

    setSubmitting(true)
    setFormError("")

    try {
      await onConfirm({
        quantity: qty,
        jobId: selectedJob.id,
        jobLabel: formatJobWithCustomerLabel(selectedJob),
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to record usage.")
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  const title =
    step === "use"
      ? `Use — ${itemName || "Item"}`
      : step === "new-job"
        ? "New Job"
        : "New Customer"

  return (
    <div
      onClick={() => {
        if (!submitting) onClose()
      }}
      className="modal-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-panel modal-panel-job-flow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="job-flow-header">
          {step !== "use" && (
            <button
              type="button"
              className="btn-secondary btn-small"
              disabled={submitting}
              onClick={() => {
                setFormError("")
                setStep(step === "new-customer" ? "new-job" : "use")
              }}
            >
              ← Back
            </button>
          )}
          <h3>{title}</h3>
        </div>

        {loadError && <div className="notice">{loadError}</div>}
        {formError && <div className="notice">{formError}</div>}

        {step === "use" && (
          <div className="job-flow-body">
            <label className="job-flow-label" htmlFor="use-qty">
              Quantity
            </label>
            <input
              id="use-qty"
              type="number"
              inputMode="decimal"
              placeholder="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={submitting}
              className="job-flow-input"
            />

            <label className="job-flow-label" htmlFor="use-job-search">
              Job
            </label>
            <div className="job-flow-selector">
              <input
                id="use-job-search"
                type="search"
                placeholder="Search jobs…"
                value={jobQuery}
                disabled={submitting || loadingJobs}
                onChange={(e) => {
                  setJobQuery(e.target.value)
                  setShowJobResults(true)
                  if (selectedJob && formatJobWithCustomerLabel(selectedJob) !== e.target.value) {
                    setSelectedJob(null)
                  }
                }}
                onFocus={() => setShowJobResults(true)}
                className="job-flow-input"
                autoComplete="off"
              />
              {selectedJob && (
                <div className="job-flow-selected">Selected: {formatJobWithCustomerLabel(selectedJob)}</div>
              )}
              {showJobResults && (
                <div className="job-flow-results" role="listbox">
                  {loadingJobs ? (
                    <div className="job-flow-result-empty">Loading jobs…</div>
                  ) : (
                    <>
                      {filteredJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          className="job-flow-result"
                          onClick={() => selectJob(job)}
                        >
                          {formatJobWithCustomerLabel(job)}
                        </button>
                      ))}
                      {filteredJobs.length === 0 && (
                        <div className="job-flow-result-empty">No active jobs match.</div>
                      )}
                      <button type="button" className="job-flow-result job-flow-result-create" onClick={openNewJob}>
                        + Create new job
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => void handleConfirmUse()} disabled={submitting}>
                {submitting ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {step === "new-job" && (
          <form className="job-flow-body" onSubmit={(e) => void handleCreateJob(e)}>
            <label className="job-flow-label" htmlFor="new-job-customer">
              Customer
            </label>
            <div className="job-flow-selector">
              <input
                id="new-job-customer"
                type="search"
                placeholder="Search customers…"
                value={customerQuery}
                disabled={submitting}
                onChange={(e) => {
                  setCustomerQuery(e.target.value)
                  setShowCustomerResults(true)
                  if (selectedCustomer && selectedCustomer.name !== e.target.value) {
                    setSelectedCustomer(null)
                  }
                }}
                onFocus={() => setShowCustomerResults(true)}
                className="job-flow-input"
                autoComplete="off"
              />
              {selectedCustomer && (
                <div className="job-flow-selected">Selected: {selectedCustomer.name}</div>
              )}
              {showCustomerResults && (
                <div className="job-flow-results" role="listbox">
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      className="job-flow-result"
                      onClick={() => {
                        setSelectedCustomer(customer)
                        setCustomerQuery(customer.name)
                        setShowCustomerResults(false)
                        setAcknowledgeJobDuplicate(false)
                      }}
                    >
                      {customer.name}
                    </button>
                  ))}
                  {filteredCustomers.length === 0 && (
                    <div className="job-flow-result-empty">No customers match.</div>
                  )}
                  <button
                    type="button"
                    className="job-flow-result job-flow-result-create"
                    onClick={openNewCustomer}
                  >
                    + Create new customer
                  </button>
                </div>
              )}
            </div>

            <label className="job-flow-label" htmlFor="new-job-name">
              Job name
            </label>
            <input
              id="new-job-name"
              value={jobName}
              onChange={(e) => {
                setJobName(e.target.value)
                setAcknowledgeJobDuplicate(false)
              }}
              disabled={submitting}
              className="job-flow-input"
              required
            />

            {similarJobs.length > 0 && (
              <div className="job-flow-warning">
                <p>Possible duplicate job(s) for this customer:</p>
                <ul>
                  {similarJobs.slice(0, 5).map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => {
                          const full = jobs.find((j) => j.id === job.id)
                          if (full) {
                            selectJob(full)
                            setStep("use")
                          }
                        }}
                      >
                        {formatJobLabel(selectedCustomer?.name, job.name)}
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="job-flow-check">
                  <input
                    type="checkbox"
                    checked={acknowledgeJobDuplicate}
                    onChange={(e) => setAcknowledgeJobDuplicate(e.target.checked)}
                  />
                  Create anyway
                </label>
              </div>
            )}

            <label className="job-flow-label" htmlFor="new-job-address">
              Job-site address (optional)
            </label>
            <input
              id="new-job-address"
              value={jobAddress}
              onChange={(e) => setJobAddress(e.target.value)}
              disabled={submitting}
              className="job-flow-input"
            />

            <label className="job-flow-label" htmlFor="new-job-notes">
              Notes (optional)
            </label>
            <textarea
              id="new-job-notes"
              value={jobNotes}
              onChange={(e) => setJobNotes(e.target.value)}
              disabled={submitting}
              className="job-flow-textarea"
              rows={3}
            />

            <div className="modal-actions">
              <button type="button" onClick={() => setStep("use")} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Creating…" : "Create & Use"}
              </button>
            </div>
          </form>
        )}

        {step === "new-customer" && (
          <form className="job-flow-body" onSubmit={(e) => void handleCreateCustomer(e)}>
            <label className="job-flow-label" htmlFor="new-customer-name">
              Customer name
            </label>
            <input
              id="new-customer-name"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value)
                setAcknowledgeCustomerDuplicate(false)
              }}
              disabled={submitting}
              className="job-flow-input"
              required
            />

            {similarCustomers.length > 0 && (
              <div className="job-flow-warning">
                <p>Possible duplicate customer(s):</p>
                <ul>
                  {similarCustomers.slice(0, 5).map((customer) => (
                    <li key={customer.id}>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => {
                          setSelectedCustomer(customer)
                          setCustomerQuery(customer.name)
                          setShowCustomerResults(false)
                          setStep("new-job")
                        }}
                      >
                        {customer.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="job-flow-check">
                  <input
                    type="checkbox"
                    checked={acknowledgeCustomerDuplicate}
                    onChange={(e) => setAcknowledgeCustomerDuplicate(e.target.checked)}
                  />
                  Create anyway
                </label>
              </div>
            )}

            <label className="job-flow-label" htmlFor="new-customer-phone">
              Phone (optional)
            </label>
            <input
              id="new-customer-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              disabled={submitting}
              className="job-flow-input"
              inputMode="tel"
            />

            <label className="job-flow-label" htmlFor="new-customer-email">
              Email (optional)
            </label>
            <input
              id="new-customer-email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              disabled={submitting}
              className="job-flow-input"
            />

            <label className="job-flow-label" htmlFor="new-customer-address">
              Address (optional)
            </label>
            <input
              id="new-customer-address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              disabled={submitting}
              className="job-flow-input"
            />

            <label className="job-flow-label" htmlFor="new-customer-notes">
              Notes (optional)
            </label>
            <textarea
              id="new-customer-notes"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              disabled={submitting}
              className="job-flow-textarea"
              rows={3}
            />

            <div className="modal-actions">
              <button type="button" onClick={() => setStep("new-job")} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
