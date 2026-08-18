"use client"

import { useEffect, useMemo, useState } from "react"
import CustomerPicker from "./CustomerPicker"
import JobPicker from "./JobPicker"
import NewCustomerForm from "./NewCustomerForm"
import NewJobForm from "./NewJobForm"
import { Button, ModalShell, Notice } from "./ui"
import {
  fetchItemHoldFields,
  loadActiveJobsWithCustomers,
  loadCustomersOrdered,
  placeItemHoldRpc,
} from "../../lib/customerJobApi"
import {
  formatJobWithCustomerLabel,
  type Customer,
  type JobWithCustomer,
} from "../../lib/customersJobs"

export type HoldPlacedResult =
  | {
      itemId: string
      holdCustomerId: string | null
      holdJobId: string | null
      holdLastName: string | null
      holdAt: string | null
      refreshRequired?: false
    }
  | {
      itemId: string
      refreshRequired: true
    }

type HoldItemModalProps = {
  itemId: string
  itemName: string | null
  onClose: () => void
  onPlaced: (result: HoldPlacedResult) => void
}

type FlowStep = "hold" | "new-job" | "new-customer"

export default function HoldItemModal({ itemId, itemName, onClose, onPlaced }: HoldItemModalProps) {
  const [step, setStep] = useState<FlowStep>("hold")
  const [customerReturnStep, setCustomerReturnStep] = useState<FlowStep>("hold")
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

  useEffect(() => {
    if (!selectedJob) return
    if (selectedCustomer && selectedJob.customer_id === selectedCustomer.id) return
    setSelectedJob(null)
    setJobQuery("")
  }, [selectedCustomer, selectedJob])

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

  const activeJobsForSelectedCustomer = useMemo(() => {
    if (!selectedCustomer) return []
    return jobs.filter(
      (job) =>
        job.customer_id === selectedCustomer.id && (job.status || "").toLowerCase() === "active",
    )
  }, [jobs, selectedCustomer])

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

  const openNewCustomer = (returnTo: FlowStep) => {
    setFormError("")
    setCustomerReturnStep(returnTo)
    setStep("new-customer")
  }

  const applySelectedCustomer = (customer: Customer, nextStep: FlowStep) => {
    setCustomers((prev) => {
      if (prev.some((c) => c.id === customer.id)) return prev
      return [...prev, customer].sort((a, b) => a.name.localeCompare(b.name))
    })
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setShowCustomerResults(false)
    // selectedJob cleared by effect when customer_id mismatches; NewJobForm stays mounted
    setStep(nextStep)
  }

  const handlePlaceHold = async () => {
    if (submitting) return
    if (!selectedCustomer) {
      setFormError("Select a customer.")
      return
    }

    if (selectedJob && selectedJob.customer_id !== selectedCustomer.id) {
      setSelectedJob(null)
      setJobQuery("")
      setFormError(
        "The selected job does not belong to this customer. Choose a matching job or place a customer-only hold.",
      )
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

    const readback = await fetchItemHoldFields(id)
    if (readback.error || !readback.data) {
      onPlaced({ itemId: id, refreshRequired: true })
      setSubmitting(false)
      return
    }

    onPlaced({
      itemId: readback.data.id,
      holdCustomerId: readback.data.hold_customer_id,
      holdJobId: readback.data.hold_job_id,
      holdLastName: readback.data.hold_last_name,
      holdAt: readback.data.hold_at,
    })
    setSubmitting(false)
  }

  const title =
    step === "hold" ? `Hold — ${itemName || "Item"}` : step === "new-job" ? "New Job" : "New Customer"

  const jobEmptyMessage = !selectedCustomer
    ? "Select a customer first."
    : activeJobsForSelectedCustomer.length === 0
      ? "No active jobs for this customer."
      : "No jobs match your search."

  return (
    <ModalShell
      ariaLabel={title}
      dismissDisabled={submitting}
      onEscape={() => {
        if (!submitting) onClose()
      }}
      onOverlayClick={() => {
        if (!submitting) onClose()
      }}
    >
        <div className="job-flow-header">
          {step !== "hold" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={submitting}
              onClick={() => {
                setFormError("")
                if (step === "new-customer") setStep(customerReturnStep)
                else setStep("hold")
              }}
            >
              ← Back
            </Button>
          )}
          <h3>{title}</h3>
        </div>

        {loadError && <Notice>{loadError}</Notice>}
        {formError && <Notice>{formError}</Notice>}

        {step === "hold" && (
          <div className="job-flow-body">
            <p className="subtext job-flow-lead">
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
              onCreateNew={() => openNewCustomer("hold")}
              disabled={submitting || loading}
            />

            <JobPicker
              id="hold-job-search"
              label="Job (optional)"
              jobs={activeJobsForSelectedCustomer}
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
              emptyMessage={jobEmptyMessage}
            />

            {selectedCustomer && !loading && activeJobsForSelectedCustomer.length === 0 && (
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
              <Button onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={submitting || !selectedCustomer}
                onClick={() => void handlePlaceHold()}
              >
                {submitting ? "Saving…" : "Place Hold"}
              </Button>
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
            onRequestCreateCustomer={() => openNewCustomer("new-job")}
            onError={setFormError}
            submitLabel="Create Job"
          />
        )}

        {step === "new-customer" && (
          <NewCustomerForm
            customers={customers}
            submitting={submitting}
            onSubmittingChange={setSubmitting}
            onCancel={() => setStep(customerReturnStep)}
            onCreated={(customer) => applySelectedCustomer(customer, customerReturnStep)}
            onSelectExisting={(customer) => applySelectedCustomer(customer, customerReturnStep)}
            onError={setFormError}
          />
        )}
    </ModalShell>
  )
}
