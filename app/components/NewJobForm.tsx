"use client"

import { FormEvent, useMemo, useState } from "react"
import CustomerPicker from "./CustomerPicker"
import { createJobRecord } from "../../lib/customerJobApi"
import {
  findSimilarJobsForCustomer,
  formatJobLabel,
  type Customer,
  type JobWithCustomer,
} from "../../lib/customersJobs"

type NewJobFormProps = {
  customers: Customer[]
  jobs: JobWithCustomer[]
  selectedCustomer: Customer | null
  onSelectCustomer: (customer: Customer | null) => void
  customerQuery: string
  onCustomerQueryChange: (value: string) => void
  showCustomerResults: boolean
  onShowCustomerResults: (show: boolean) => void
  submitting: boolean
  onSubmittingChange: (submitting: boolean) => void
  onCancel: () => void
  onCreated: (job: JobWithCustomer) => void
  onSelectExistingJob: (job: JobWithCustomer) => void
  onRequestCreateCustomer: () => void
  onError: (message: string) => void
  hidden?: boolean
  submitLabel?: string
  submittingLabel?: string
}

export default function NewJobForm({
  customers,
  jobs,
  selectedCustomer,
  onSelectCustomer,
  customerQuery,
  onCustomerQueryChange,
  showCustomerResults,
  onShowCustomerResults,
  submitting,
  onSubmittingChange,
  onCancel,
  onCreated,
  onSelectExistingJob,
  onRequestCreateCustomer,
  onError,
  hidden = false,
  submitLabel = "Create & Use",
  submittingLabel = "Creating…",
}: NewJobFormProps) {
  const [jobName, setJobName] = useState("")
  const [jobAddress, setJobAddress] = useState("")
  const [jobNotes, setJobNotes] = useState("")
  const [acknowledgeJobDuplicate, setAcknowledgeJobDuplicate] = useState(false)

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return

    if (!selectedCustomer) {
      onError("Select or create a customer.")
      return
    }

    const trimmedName = jobName.trim()
    if (!trimmedName) {
      onError("Job name is required.")
      return
    }

    if (similarJobs.length > 0 && !acknowledgeJobDuplicate) {
      onError(
        "Possible duplicate job found for this customer. Confirm to continue, or pick the existing job.",
      )
      return
    }

    onSubmittingChange(true)
    onError("")

    const { data, error } = await createJobRecord({
      customerId: selectedCustomer.id,
      name: trimmedName,
      address: jobAddress,
      notes: jobNotes,
    })

    onSubmittingChange(false)

    if (error || !data) {
      onError(error || "Failed to create job.")
      return
    }

    onCreated({
      ...data,
      customer: selectedCustomer,
    })
  }

  return (
    <form
      className="job-flow-body"
      onSubmit={(e) => void handleSubmit(e)}
      style={hidden ? { display: "none" } : undefined}
      aria-hidden={hidden}
    >
      <CustomerPicker
        id="new-job-customer"
        customers={customers}
        query={customerQuery}
        onQueryChange={(value) => {
          onCustomerQueryChange(value)
          if (selectedCustomer && selectedCustomer.name !== value) {
            onSelectCustomer(null)
          }
        }}
        selected={selectedCustomer}
        onSelect={(customer) => {
          onSelectCustomer(customer)
          onCustomerQueryChange(customer.name)
          onShowCustomerResults(false)
          setAcknowledgeJobDuplicate(false)
        }}
        showResults={showCustomerResults}
        onShowResults={onShowCustomerResults}
        onCreateNew={onRequestCreateCustomer}
        disabled={submitting}
      />

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
                    if (full) onSelectExistingJob(full)
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
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}
