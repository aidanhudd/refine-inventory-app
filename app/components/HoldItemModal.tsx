"use client"

import { useEffect, useMemo, useState } from "react"
import CustomerPicker from "./CustomerPicker"
import JobPicker from "./JobPicker"
import NewCustomerForm from "./NewCustomerForm"
import NewJobForm from "./NewJobForm"
import {
  filterJobsForCustomer,
  loadActiveJobsWithCustomers,
  loadCustomersOrdered,
  placeItemHoldRpc,
} from "../../lib/customerJobApi"
import {
  formatJobWithCustomerLabel,
  type Customer,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type HoldItemModalProps = {
  itemId: string
  itemName: string | null
  onClose: () => void
  onPlaced: (payload: {
    itemId: string
    holdCustomerId: string
    holdJobId: string | null
    holdLastName: string
    holdAt: string
  }) => void
}

type FlowStep = "hold" | "new-job" | "new-customer"

export default function HoldItemModal({ itemId, itemName, onClose, onPlaced }: HoldItemModalProps) {
  const [step, setStep] = useState<FlowStep>("hold")
  const [flowSession, setFlowSession] = useState(0)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [jobs, setJobs] = useState<JobWithCustomer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobWithCustomer | null>(null)
  const [customerQuery, setCustomerQuery] = useState("")
  const [jobQuery, setJobQuery] = useState("")
  const [showCustomerResults, setShowCustomerResults] = useState(false)
  const [showJobResults, setShowJobResults] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setLoadError("")
    const [customersRes, jobsRes] = await Promise.all([
      loadCustomersOrdered({ activeOnly: true }),
      loadActiveJobsWithCustomers(),
    ])
    if (customersRes.error) {
      setLoadError(customersRes.error)
      setLoading(false)
      return
    }
    if (jobsRes.error) {
      setLoadError(jobsRes.error)
      setLoading(false)
      return
    }
    setCustomers(customersRes.data)
    setJobs(jobsRes.data)
    setLoading(false)
  }

  const jobsForCustomer = useMemo(() => {
    if (!selectedCustomer) return []
    return filterJobsForCustomer(jobs, selectedCustomer.id, jobQuery, 40)
  }, [jobs, selectedCustomer, jobQuery])

  const openNewJob = () => {
    if (!selectedCustomer) {
      setFormError("Select a customer before creating a job.")
      return
    }
    setFormError("")
    setCustomerQuery(selectedCustomer.name)
    setShowCustomerResults(false)
    setFlowSession((v) => v + 1)
    setStep("new-job")
  }

  const handlePlaceHold = async () => {
    if (submitting) return
    if (!selectedCustomer) {
      setFormError("Select a customer.")
      return
    }

    setSubmitting(true)
    setFormError("")

    const { id, error } = await placeItemHoldRpc(itemId, selectedCustomer.id, selectedJob?.id || null)
    if (error || !id) {
      setFormError(error || "Failed to place hold.")
      setSubmitting(false)
      return
    }

    const holdLastName = selectedJob
      ? formatJobWithCustomerLabel({ ...selectedJob, customer: selectedCustomer })
      : selectedCustomer.name.trim()

    onPlaced({
      itemId: id,
      holdCustomerId: selectedCustomer.id,
      holdJobId: selectedJob?.id || null,
      holdLastName,
      holdAt: new Date().toISOString(),
    })
    setSubmitting(false)
  }

  const title =
    step === "hold" ? `Hold — ${itemName || "Item"}` : step === "new-job" ? "New Job" : "New Customer"

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!submitting) onClose()
      }}
    >
      <div
        className="modal-panel modal-panel-job-flow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="job-flow-header">
          {step !== "hold" && (
            <button
              type="button"
              className="btn-secondary btn-small"
              disabled={submitting}
              onClick={() => {
                setFormError("")
                setStep(step === "new-customer" ? "new-job" : "hold")
              }}
            >
              ← Back
            </button>
          )}
          <h3>{title}</h3>
        </div>

        {loadError && <div className="notice">{loadError}</div>}
        {formError && <div className="notice">{formError}</div>}

        {step === "hold" && (
          <div className="job-flow-body">
            <p className="subtext" style={{ marginBottom: 8 }}>
              Customer is required. Job is optional. Archived customers are hidden.
            </p>

            <CustomerPicker
              id="hold-customer-search"
              customers={customers}
              query={customerQuery}
              onQueryChange={(value) => {
                setCustomerQuery(value)
                if (selectedCustomer && selectedCustomer.name !== value) {
                  setSelectedCustomer(null)
                  setSelectedJob(null)
                  setJobQuery("")
                }
              }}
              selected={selectedCustomer}
              onSelect={(customer) => {
                setSelectedCustomer(customer)
                setCustomerQuery(customer.name)
                setShowCustomerResults(false)
                setSelectedJob(null)
                setJobQuery("")
                setFormError("")
              }}
              showResults={showCustomerResults}
              onShowResults={setShowCustomerResults}
              onCreateNew={() => {
                setFormError("")
                setFlowSession((v) => v + 1)
                setStep("new-customer")
              }}
              disabled={submitting || loading}
            />

            <JobPicker
              id="hold-job-search"
              label="Job (optional)"
              jobs={selectedCustomer ? jobs.filter((j) => j.customer_id === selectedCustomer.id) : []}
              query={jobQuery}
              onQueryChange={(value) => {
                setJobQuery(value)
                if (selectedJob && formatJobWithCustomerLabel(selectedJob) !== value) {
                  setSelectedJob(null)
                }
              }}
              selected={selectedJob}
              onSelect={(job) => {
                setSelectedJob(job)
                setJobQuery(formatJobWithCustomerLabel(job))
                setShowJobResults(false)
              }}
              showResults={showJobResults && !!selectedCustomer}
              onShowResults={setShowJobResults}
              onCreateNew={selectedCustomer ? openNewJob : undefined}
              disabled={submitting || loading || !selectedCustomer}
              loading={loading}
              emptyMessage={
                selectedCustomer ? "No active jobs for this customer." : "Select a customer first."
              }
            />

            {jobsForCustomer.length === 0 && selectedCustomer && !loading && (
              <div className="small">No active jobs yet — you can create one or place a customer-only hold.</div>
            )}

            {(selectedCustomer || selectedJob) && (
              <div className="job-flow-selected">
                Selected:{" "}
                {selectedJob
                  ? formatJobWithCustomerLabel({ ...selectedJob, customer: selectedCustomer })
                  : selectedCustomer?.name}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={submitting || !selectedCustomer}
                onClick={() => void handlePlaceHold()}
              >
                {submitting ? "Saving…" : "Place Hold"}
              </button>
            </div>
          </div>
        )}

        {step !== "hold" && (
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
            onCancel={() => setStep("hold")}
            onCreated={(job) => {
              setJobs((prev) => [...prev, job].sort((a, b) => a.name.localeCompare(b.name)))
              setSelectedJob(job)
              setJobQuery(formatJobWithCustomerLabel(job))
              setShowJobResults(false)
              setStep("hold")
            }}
            onSelectExistingJob={(job) => {
              setSelectedJob(job)
              setJobQuery(formatJobWithCustomerLabel(job))
              setStep("hold")
            }}
            onRequestCreateCustomer={() => {
              setFormError("")
              setStep("new-customer")
            }}
            onError={setFormError}
            submitLabel="Create Job"
          />
        )}

        {step === "new-customer" && (
          <NewCustomerForm
            customers={customers}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onCancel={() => setStep("hold")}
            onCreated={(customer) => {
              setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)))
              setSelectedCustomer(customer)
              setCustomerQuery(customer.name)
              setShowCustomerResults(false)
              setSelectedJob(null)
              setJobQuery("")
              setStep("hold")
            }}
            onSelectExisting={(customer) => {
              setSelectedCustomer(customer)
              setCustomerQuery(customer.name)
              setShowCustomerResults(false)
              setStep("hold")
            }}
            onError={setFormError}
          />
        )}
      </div>
    </div>
  )
}
