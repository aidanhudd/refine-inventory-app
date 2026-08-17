"use client"

import { useMemo } from "react"
import { filterCustomersByQuery } from "../../lib/customerJobApi"
import type { Customer } from "../../lib/customersJobs"

type CustomerPickerProps = {
  id?: string
  label?: string
  customers: Customer[]
  query: string
  onQueryChange: (value: string) => void
  selected: Customer | null
  onSelect: (customer: Customer) => void
  showResults: boolean
  onShowResults: (show: boolean) => void
  onCreateNew?: () => void
  createLabel?: string
  disabled?: boolean
  emptyMessage?: string
}

export default function CustomerPicker({
  id = "customer-search",
  label = "Customer",
  customers,
  query,
  onQueryChange,
  selected,
  onSelect,
  showResults,
  onShowResults,
  onCreateNew,
  createLabel = "+ Create new customer",
  disabled = false,
  emptyMessage = "No customers match.",
}: CustomerPickerProps) {
  const filtered = useMemo(() => filterCustomersByQuery(customers, query), [customers, query])

  return (
    <div>
      <label className="job-flow-label" htmlFor={id}>
        {label}
      </label>
      <div className="job-flow-selector">
        <input
          id={id}
          type="search"
          placeholder="Search customers…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            onQueryChange(e.target.value)
            onShowResults(true)
          }}
          onFocus={() => onShowResults(true)}
          className="job-flow-input"
          autoComplete="off"
        />
        {selected && <div className="job-flow-selected">Selected: {selected.name}</div>}
        {showResults && (
          <div className="job-flow-results" role="listbox">
            {filtered.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="job-flow-result"
                onClick={() => {
                  onSelect(customer)
                  onShowResults(false)
                }}
              >
                {customer.name}
              </button>
            ))}
            {filtered.length === 0 && <div className="job-flow-result-empty">{emptyMessage}</div>}
            {onCreateNew && (
              <button type="button" className="job-flow-result job-flow-result-create" onClick={onCreateNew}>
                {createLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
