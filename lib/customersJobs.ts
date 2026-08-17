export const CUSTOMER_STATUSES = ["active", "archived"] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const JOB_STATUSES = ["active", "completed", "archived"] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  status?: CustomerStatus | string | null
  archived_at?: string | null
  created_by: string
  created_at: string | null
  updated_at: string | null
}

export type Job = {
  id: string
  customer_id: string
  name: string
  address: string | null
  notes: string | null
  status: JobStatus | string
  created_by: string
  created_at: string | null
  updated_at: string | null
  completed_at: string | null
}

export type JobWithCustomer = Job & {
  customer: Customer | null
}

export function formatJobLabel(customerName: string | null | undefined, jobName: string | null | undefined): string {
  const customer = (customerName || "").trim()
  const job = (jobName || "").trim()
  if (customer && job) return `${customer} — ${job}`
  if (job) return job
  if (customer) return customer
  return "No Job"
}

export function formatJobWithCustomerLabel(job: Pick<Job, "name"> & { customer?: Pick<Customer, "name"> | null }): string {
  return formatJobLabel(job.customer?.name, job.name)
}

export function resolveUsageJobLabel(options: {
  jobId: string | null | undefined
  jobName: string | null | undefined
  jobsById?: Map<string, JobWithCustomer>
}): string {
  const { jobId, jobName, jobsById } = options
  if (jobId && jobsById?.has(jobId)) {
    return formatJobWithCustomerLabel(jobsById.get(jobId)!)
  }
  const legacy = (jobName || "").trim()
  return legacy || "No Job"
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function jobMatchesSearch(job: JobWithCustomer, query: string): boolean {
  const normalized = normalizeSearchText(query)
  if (!normalized) return true
  const customerName = job.customer?.name || ""
  const label = formatJobLabel(customerName, job.name)
  return (
    normalizeSearchText(customerName).includes(normalized) ||
    normalizeSearchText(job.name).includes(normalized) ||
    normalizeSearchText(label).includes(normalized)
  )
}

export function findSimilarCustomers(customers: Customer[], name: string): Customer[] {
  const normalized = normalizeSearchText(name)
  if (!normalized) return []
  return customers.filter((customer) => {
    const existing = normalizeSearchText(customer.name)
    return existing === normalized || existing.includes(normalized) || normalized.includes(existing)
  })
}

export function findSimilarJobsForCustomer(jobs: Job[], customerId: string, name: string): Job[] {
  const normalized = normalizeSearchText(name)
  if (!normalized || !customerId) return []
  return jobs.filter((job) => {
    if (job.customer_id !== customerId) return false
    if ((job.status || "").toLowerCase() !== "active") return false
    const existing = normalizeSearchText(job.name)
    return existing === normalized || existing.includes(normalized) || normalized.includes(existing)
  })
}

export function isCustomerActive(customer: Pick<Customer, "status"> | null | undefined): boolean {
  return (customer?.status || "active").toLowerCase() === "active"
}

export function canManageJobStatus(role: string | null | undefined): boolean {
  return role === "manager" || role === "admin"
}

export function canManageCustomers(role: string | null | undefined): boolean {
  return role === "manager" || role === "admin"
}

export function canUndoSharedUsage(options: {
  usageUserId: string | null | undefined
  currentUserId: string | null | undefined
  role: string | null | undefined
}): boolean {
  const { usageUserId, currentUserId, role } = options
  if (!currentUserId) return false
  if (usageUserId && usageUserId === currentUserId) return true
  return role === "manager" || role === "admin"
}

/** Parse PHASE2:<CODE>:<message> (and common PostgREST wrappers). */
export function parsePhase2Error(message: string | null | undefined): {
  code: string | null
  detail: string
} {
  const raw = (message || "").trim()
  if (!raw) return { code: null, detail: "Something went wrong." }

  const match = raw.match(/PHASE2:([A-Z0-9_]+):([\s\S]+)$/)
  if (match) {
    return { code: match[1], detail: match[2].trim() }
  }
  return { code: null, detail: raw }
}

const PHASE2_FRIENDLY: Record<string, string> = {
  FORBIDDEN: "You do not have permission to do that.",
  CUSTOMER_STATUS_FORBIDDEN: "Only managers and admins can archive or reopen customers.",
  CUSTOMER_NOT_FOUND: "Customer was not found.",
  CUSTOMER_ARCHIVED: "That customer is archived. Reopen the customer first.",
  CUSTOMER_ALREADY_ARCHIVED: "That customer is already archived.",
  CUSTOMER_ALREADY_ACTIVE: "That customer is already active.",
  CUSTOMER_HAS_ACTIVE_JOBS: "Archive blocked: complete or archive active jobs first.",
  CUSTOMER_HAS_STRUCTURED_HOLDS: "Blocked: release structured holds for this customer first.",
  CUSTOMER_HAS_JOBS: "Delete blocked: this customer still has jobs. Archive instead.",
  JOB_NOT_FOUND: "Job was not found.",
  JOB_NOT_ACTIVE: "That job is not active.",
  JOB_HAS_USAGE: "Delete blocked: this job has usage history. Archive instead.",
  JOB_HAS_STRUCTURED_HOLDS: "Delete blocked: release structured holds on this job first.",
  HOLD_CUSTOMER_REQUIRED: "Select a customer for the hold.",
  HOLD_JOB_WITHOUT_CUSTOMER: "A job hold also requires a customer.",
  HOLD_JOB_CUSTOMER_MISMATCH: "That job does not belong to the selected customer.",
  HOLD_INCOMPLETE: "Hold data was incomplete. Try again.",
  ITEM_NOT_FOUND: "Inventory item was not found.",
  ITEM_ALREADY_HELD: "This item is already on hold. Release it first.",
  ITEM_NOT_HELD: "This item is not currently on hold.",
}

export function formatPhase2Error(message: string | null | undefined): string {
  const { code, detail } = parsePhase2Error(message)
  if (code && PHASE2_FRIENDLY[code]) return PHASE2_FRIENDLY[code]
  if (code) return detail || PHASE2_FRIENDLY.FORBIDDEN
  return detail
}
