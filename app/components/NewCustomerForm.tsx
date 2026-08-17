"use client"

import { FormEvent, useMemo, useState } from "react"
import { createCustomerRecord } from "../../lib/customerJobApi"
import { findSimilarCustomers, type Customer } from "../../lib/customersJobs"

type NewCustomerFormProps = {
  customers: Customer[]
  submitting: boolean
  onSubmittingChange: (submitting: boolean) => void
  onCancel: () => void
  onCreated: (customer: Customer) => void
  onSelectExisting: (customer: Customer) => void
  onError: (message: string) => void
}

export default function NewCustomerForm({
  customers,
  submitting,
  onSubmittingChange,
  onCancel,
  onCreated,
  onSelectExisting,
  onError,
}: NewCustomerFormProps) {
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [customerNotes, setCustomerNotes] = useState("")
  const [acknowledgeCustomerDuplicate, setAcknowledgeCustomerDuplicate] = useState(false)

  const similarCustomers = useMemo(
    () => findSimilarCustomers(customers, customerName),
    [customers, customerName],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return

    const trimmedName = customerName.trim()
    if (!trimmedName) {
      onError("Customer name is required.")
      return
    }

    if (similarCustomers.length > 0 && !acknowledgeCustomerDuplicate) {
      onError("Possible duplicate customer found. Confirm to continue, or pick an existing customer.")
      return
    }

    onSubmittingChange(true)
    onError("")

    const { data, error } = await createCustomerRecord({
      name: trimmedName,
      phone: customerPhone,
      email: customerEmail,
      address: customerAddress,
      notes: customerNotes,
    })

    onSubmittingChange(false)

    if (error || !data) {
      onError(error || "Failed to create customer.")
      return
    }

    onCreated(data)
  }

  return (
    <form className="job-flow-body" onSubmit={(e) => void handleSubmit(e)}>
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
                <button type="button" className="linkish" onClick={() => onSelectExisting(customer)}>
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
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  )
}
