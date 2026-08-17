export type HoldFields = {
  hold_last_name?: string | null
  hold_at?: string | null
  hold_customer_id?: string | null
  hold_job_id?: string | null
}

export function isItemOnHold(
  holdLastName: string | null | undefined,
  holdCustomerId?: string | null,
  holdJobId?: string | null,
): boolean {
  if (holdCustomerId || holdJobId) return true
  return !!(holdLastName && holdLastName.trim())
}

export function isItemOnHoldFields(item: HoldFields): boolean {
  return isItemOnHold(item.hold_last_name, item.hold_customer_id, item.hold_job_id)
}

export function formatHoldLastName(value: string): string {
  return value.trim()
}

/** Prefer snapshot (always written for structured holds); fallback to customer/job names. */
export function formatHoldDisplayLabel(options: {
  holdLastName?: string | null
  customerName?: string | null
  jobName?: string | null
}): string {
  const snapshot = (options.holdLastName || "").trim()
  if (snapshot) return snapshot
  const customer = (options.customerName || "").trim()
  const job = (options.jobName || "").trim()
  if (customer && job) return `${customer} — ${job}`
  if (customer) return customer
  return "On hold"
}

export function holdJobSublabel(options: {
  holdLastName?: string | null
  jobName?: string | null
}): string | null {
  const job = (options.jobName || "").trim()
  if (job) return job
  const snapshot = (options.holdLastName || "").trim()
  const parts = snapshot.split(" — ")
  if (parts.length >= 2) return parts.slice(1).join(" — ").trim() || null
  return null
}
