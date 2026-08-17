"use client"

import { useEffect, useState } from "react"
import CustomerPicker from "./CustomerPicker"
import JobPicker from "./JobPicker"
import NewCustomerForm from "./NewCustomerForm"
import NewJobForm from "./NewJobForm"
import {
  loadActiveJobsWithCustomers,
  loadCustomersOrdered,
} from "../../lib/customerJobApi"
import {
  formatJobWithCustomerLabel,
  type Customer,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type UseInventoryModalProps = {
  itemName: string | null
  onClose: () => void
  onConfirm: (payload: { quantity: number; jobId: string; jobLabel: string }) => Promise<void>
}

type FlowStep = "use" | "new-job" | "new-customer"

export default function UseInventoryModal({ itemName, onClose, onConfirm }: UseInventoryModalProps) {
  const [step, setStep] = useState<FlowStep>("use")
  const [flowSession, setFlowSession] = useState(0)
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

  useEffect(() => {
    void loadCustomersAndJobs()
  }, [])

  const loadCustomersAndJobs = async () => {
    setLoadingJobs(true)
    setLoadError("")

    const [customersRes, jobsRes] = await Promise.all([
      loadCustomersOrdered(),
      loadActiveJobsWithCustomers(),
    ])

    if (customersRes.error) {
      setLoadError(customersRes.error)
      setLoadingJobs(false)
      return
    }
    if (jobsRes.error) {
      setLoadError(jobsRes.error)
      setLoadingJobs(false)
      return
    }

    setCustomers(customersRes.data)
    setJobs(jobsRes.data)
    setLoadingJobs(false)
  }

  const selectJob = (job: JobWithCustomer) => {
    setSelectedJob(job)
    setJobQuery(formatJobWithCustomerLabel(job))
    setShowJobResults(false)
    setFormError("")
  }

  const openNewJob = () => {
    setFormError("")
    setSelectedCustomer(null)
    setCustomerQuery("")
    setShowCustomerResults(false)
    setFlowSession((value) => value + 1)
    setStep("new-job")
  }

  const openNewCustomer = () => {
    setFormError("")
    setStep("new-customer")
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

            <JobPicker
              id="use-job-search"
              jobs={jobs}
              query={jobQuery}
              onQueryChange={(value) => {
                setJobQuery(value)
                if (selectedJob && formatJobWithCustomerLabel(selectedJob) !== value) {
                  setSelectedJob(null)
                }
              }}
              selected={selectedJob}
              onSelect={selectJob}
              showResults={showJobResults}
              onShowResults={setShowJobResults}
              onCreateNew={openNewJob}
              disabled={submitting}
              loading={loadingJobs}
            />

            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleConfirmUse()}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {step !== "use" && (
          <NewJobForm
            key={flowSession}
            hidden={step !== "new-job"}
            customers={customers}
            jobs={jobs}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
            customerQuery={customerQuery}
            onCustomerQueryChange={setCustomerQuery}
            showCustomerResults={showCustomerResults}
            onShowCustomerResults={setShowCustomerResults}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onCancel={() => setStep("use")}
            onCreated={(job) => {
              setJobs((prev) => [...prev, job].sort((a, b) => a.name.localeCompare(b.name)))
              selectJob(job)
              setStep("use")
            }}
            onSelectExistingJob={(job) => {
              selectJob(job)
              setStep("use")
            }}
            onRequestCreateCustomer={openNewCustomer}
            onError={setFormError}
          />
        )}

        {step === "new-customer" && (
          <NewCustomerForm
            customers={customers}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onCancel={() => setStep("new-job")}
            onCreated={(customer) => {
              setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)))
              setSelectedCustomer(customer)
              setCustomerQuery(customer.name)
              setShowCustomerResults(false)
              setStep("new-job")
            }}
            onSelectExisting={(customer) => {
              setSelectedCustomer(customer)
              setCustomerQuery(customer.name)
              setShowCustomerResults(false)
              setStep("new-job")
            }}
            onError={setFormError}
          />
        )}
      </div>
    </div>
  )
}
