import type { JobsViewMode, NavItemId } from "./types"

/**
 * Fixed local registry for primary nav links.
 * Appearance config may reorder these IDs only — never change href, label, or permissions.
 */
export const NAV_LINK_REGISTRY: Record<
  NavItemId,
  { href: string; label: string }
> = {
  inventory: { href: "/", label: "Inventory" },
  jobs: { href: "/jobs", label: "Jobs" },
  estimate: { href: "/estimate", label: "Estimate" },
}

/**
 * Fixed local registry for Jobs page tabs.
 * Appearance config may reorder / set default — labels and behavior stay here.
 */
export const JOBS_TAB_REGISTRY: Record<JobsViewMode, { label: string }> = {
  customers: { label: "Customers & Jobs" },
  holds: { label: "Holds" },
  usage: { label: "Job Usage" },
}
