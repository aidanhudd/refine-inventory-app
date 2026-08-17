export const JOB_STATUSES = ["active", "completed", "archived"] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
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

export function canManageJobStatus(role: string | null | undefined): boolean {
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
