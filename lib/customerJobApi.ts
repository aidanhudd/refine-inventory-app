import { supabase } from "./supabaseClient"
import { jobMatchesSearch, type Customer, type Job, type JobWithCustomer } from "./customersJobs"

export const CUSTOMER_SELECT =
  "id, name, phone, email, address, notes, created_by, created_at, updated_at"

export const JOB_SELECT =
  "id, customer_id, name, address, notes, status, created_by, created_at, updated_at, completed_at"

type JobRow = Job & { customer: Customer | Customer[] | null }

export function mapJobsWithCustomer(rows: JobRow[] | null | undefined): JobWithCustomer[] {
  return (rows || []).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? row.customer[0] || null : row.customer,
  }))
}

export async function loadCustomersOrdered(): Promise<{ data: Customer[]; error: string | null }> {
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_SELECT)
    .order("name", { ascending: true })

  if (error) return { data: [], error: error.message }
  return { data: (data as Customer[]) || [], error: null }
}

export async function loadActiveJobsWithCustomers(): Promise<{
  data: JobWithCustomer[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from("jobs")
    .select(`${JOB_SELECT}, customer:customers(${CUSTOMER_SELECT})`)
    .eq("status", "active")
    .order("name", { ascending: true })

  if (error) return { data: [], error: error.message }
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
    })
    .select(CUSTOMER_SELECT)
    .single()

  if (error || !data) return { data: null, error: error?.message || "Failed to create customer." }
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

  if (error || !data) return { data: null, error: error?.message || "Failed to create job." }
  return { data: data as Job, error: null }
}

export function filterCustomersByQuery(customers: Customer[], query: string, limit = 40): Customer[] {
  const q = query.trim().toLowerCase()
  if (!q) return customers.slice(0, limit)
  return customers.filter((customer) => customer.name.toLowerCase().includes(q)).slice(0, limit)
}

export function filterJobsByQuery(jobs: JobWithCustomer[], query: string, limit = 40): JobWithCustomer[] {
  return jobs.filter((job) => jobMatchesSearch(job, query)).slice(0, limit)
}
