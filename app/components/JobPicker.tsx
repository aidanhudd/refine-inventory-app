"use client"

import { useMemo } from "react"
import { filterJobsByQuery } from "../../lib/customerJobApi"
import { formatJobWithCustomerLabel, type JobWithCustomer } from "../../lib/customersJobs"

type JobPickerProps = {
  id?: string
  label?: string
  jobs: JobWithCustomer[]
  query: string
  onQueryChange: (value: string) => void
  selected: JobWithCustomer | null
  onSelect: (job: JobWithCustomer) => void
  showResults: boolean
  onShowResults: (show: boolean) => void
  onCreateNew?: () => void
  createLabel?: string
  disabled?: boolean
  loading?: boolean
  emptyMessage?: string
  loadingMessage?: string
}

export default function JobPicker({
  id = "job-search",
  label = "Job",
  jobs,
  query,
  onQueryChange,
  selected,
  onSelect,
  showResults,
  onShowResults,
  onCreateNew,
  createLabel = "+ Create new job",
  disabled = false,
  loading = false,
  emptyMessage = "No active jobs match.",
  loadingMessage = "Loading jobs…",
}: JobPickerProps) {
  const filtered = useMemo(() => filterJobsByQuery(jobs, query), [jobs, query])

  return (
    <div>
      <label className="job-flow-label" htmlFor={id}>
        {label}
      </label>
      <div className="job-flow-selector">
        <input
          id={id}
          type="search"
          placeholder="Search jobs…"
          value={query}
          disabled={disabled || loading}
          onChange={(e) => {
            onQueryChange(e.target.value)
            onShowResults(true)
          }}
          onFocus={() => onShowResults(true)}
          className="job-flow-input"
          autoComplete="off"
        />
        {selected && (
          <div className="job-flow-selected">Selected: {formatJobWithCustomerLabel(selected)}</div>
        )}
        {showResults && (
          <div className="job-flow-results" role="listbox">
            {loading ? (
              <div className="job-flow-result-empty">{loadingMessage}</div>
            ) : (
              <>
                {filtered.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="job-flow-result"
                    onClick={() => {
                      onSelect(job)
                      onShowResults(false)
                    }}
                  >
                    {formatJobWithCustomerLabel(job)}
                  </button>
                ))}
                {filtered.length === 0 && <div className="job-flow-result-empty">{emptyMessage}</div>}
                {onCreateNew && (
                  <button
                    type="button"
                    className="job-flow-result job-flow-result-create"
                    onClick={onCreateNew}
                  >
                    {createLabel}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
