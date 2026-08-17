import { supabase } from "./supabaseClient"
import {
  formatPhase2Error,
  jobMatchesSearch,
  type Customer,
  type Job,
  type JobWithCustomer,
} from "./customersJobs"

export const CUSTOMER_SELECT =
  "id, name, phone, email, address, notes, status, archived_at, created_by, created_at, updated_at"

export const JOB_SELECT =
  "id, customer_id, name, address, notes, status, created_by, created_at, updated_at, completed_at"

type JobRow = Job & { customer: Customer | Customer[] | null }

export function mapJobsWithCustomer(rows: JobRow[] | null | undefined): JobWithCustomer[] {
  return (rows || []).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer,
  }))
}

export async function loadCustomersOrdered(options?: {
  activeOnly?: boolean
}): Promise<{ data: Customer[]; error: string | null }> {
  let query = supabase.from("customers").select(CUSTOMER_SELECT).order("name", { ascending: true })
  if (options?.activeOnly) {
    query = query.eq("status", "active")
  }
  const { data, error } = await query
  if (error) return { data: [], error: formatPhase2Error(error.message) }
  return { data: (data as Customer[]) || [], error: null }
}

/** Active jobs whose customer is also active (for Use / Hold selectors). */
export async function loadActiveJobsWithCustomers(): Promise<{
  data: JobWithCustomer[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from("jobs")
    .select(`${JOB_SELECT}, customer:customers!inner(${CUSTOMER_SELECT})`)
    .eq("status", "active")
    .eq("customer.status", "active")
    .order("name", { ascending: true })

  if (error) return { data: [], error: formatPhase2Error(error.message) }
  return { data: mapJobsWithCustomer(data as JobRow[]), error: null }
}

export async function loadAllJobsWithCustomers(): Promise<{
  data: JobWithCustomer[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from("jobs")
    .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
    .order("name", { ascending: true })

  if (error) return { data: [], error: formatPhase2Error(error.message) }
  return { data: mapJobsWithCustomer(data as JobRow[]), error: null }
}

export async function createCustomerRecord(input: {
  name: string
  phone?: string
  email?: string
  address?: string
  notes?: string
}): Promise<{ data: Customer | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "active",
    })
    .select(CUSTOMER_SELECT)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to create customer.") }
  }
  return { data: data as Customer, error: null }
}

export async function updateCustomerRecord(
  customerId: string,
  input: {
    name: string
    phone?: string
    email?: string
    address?: string
    notes?: string
  },
): Promise<{ data: Customer | null; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .update({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", customerId)
    .select(CUSTOMER_SELECT)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to update customer.") }
  }
  return { data: data as Customer, error: null }
}

export async function createJobRecord(input: {
  customerId: string
  name: string
  address?: string
  notes?: string
}): Promise<{ data: Job | null; error: string | null }> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: input.customerId,
      name: input.name.trim(),
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "active",
    })
    .select(JOB_SELECT)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to create job.") }
  }
  return { data: data as Job, error: null }
}

export async function updateJobRecord(
  jobId: string,
  input: { name: string; address?: string; notes?: string },
): Promise<{ data: Job | null; error: string | null }> {
  const { data, error } = await supabase
    .from("jobs")
    .update({
      name: input.name.trim(),
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", jobId)
    .select(JOB_SELECT)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to update job.") }
  }
  return { data: data as Job, error: null }
}

export async function updateJobStatusRecord(
  jobId: string,
  status: "active" | "completed" | "archived",
): Promise<{ data: JobWithCustomer | null; error: string | null }> {
  const { data, error } = await supabase
    .from("jobs")
    .update({ status })
    .eq("id", jobId)
    .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to update job status.") }
  }
  return { data: mapJobsWithCustomer([data as JobRow])[0] || null, error: null }
}

async function callUuidRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) return { id: null, error: formatPhase2Error(error.message) }
  if (!data) return { id: null, error: "No result returned." }
  return { id: String(data), error: null }
}

export function archiveCustomerRpc(customerId: string) {
  return callUuidRpc("archive_customer", { p_customer_id: customerId })
}

export function reopenCustomerRpc(customerId: string) {
  return callUuidRpc("reopen_customer", { p_customer_id: customerId })
}

export function deleteUnusedJobRpc(jobId: string) {
  return callUuidRpc("delete_unused_job", { p_job_id: jobId })
}

export function deleteUnusedCustomerRpc(customerId: string) {
  return callUuidRpc("delete_unused_customer", { p_customer_id: customerId })
}

export function placeItemHoldRpc(itemId: string, customerId: string, jobId?: string | null) {
  return callUuidRpc("place_item_hold", {
    p_item_id: itemId,
    p_customer_id: customerId,
    p_job_id: jobId || null,
  })
}

export function releaseItemHoldRpc(itemId: string) {
  return callUuidRpc("release_item_hold", { p_item_id: itemId })
}

export type ItemHoldFields = {
  id: string
  hold_customer_id: string | null
  hold_job_id: string | null
  hold_last_name: string | null
  hold_at: string | null
}

export async function fetchItemHoldFields(
  itemId: string,
): Promise<{ data: ItemHoldFields | null; error: string | null }> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, hold_customer_id, hold_job_id, hold_last_name, hold_at")
    .eq("id", itemId)
    .single()

  if (error || !data) {
    return { data: null, error: formatPhase2Error(error?.message || "Failed to read hold fields.") }
  }
  return { data: data as ItemHoldFields, error: null }
}

export function filterCustomersByQuery(customers: Customer[], query: string, limit = 40): Customer[] {
  const q = query.trim().toLowerCase()
  if (!q) return customers.slice(0, limit)
  return customers.filter((customer) => customer.name.toLowerCase().includes(q)).slice(0, limit)
}

export function filterJobsByQuery(jobs: JobWithCustomer[], query: string, limit = 40): JobWithCustomer[] {
  return jobs.filter((job) => jobMatchesSearch(job, query)).slice(0, limit)
}

export function filterJobsForCustomer(
  jobs: JobWithCustomer[],
  customerId: string,
  query: string,
  limit = 40,
): JobWithCustomer[] {
  return filterJobsByQuery(
    jobs.filter((job) => job.customer_id === customerId && (job.status || "").toLowerCase() === "active"),
    query,
    limit,
  )
}
