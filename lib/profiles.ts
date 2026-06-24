export const USER_ROLES = ["pending", "employee", "manager", "admin"] as const

export type UserRole = (typeof USER_ROLES)[number]

export const APPROVED_ROLES = ["employee", "manager", "admin"] as const

export type ApprovedRole = (typeof APPROVED_ROLES)[number]

export const ASSIGNABLE_ROLES = APPROVED_ROLES

export type Profile = {
  id: string
  email: string | null
  role: UserRole
  approved_at: string | null
  approved_by: string | null
  full_name: string | null
  created_at: string | null
}

export const PROFILE_SELECT = "id, email, role, approved_at, approved_by, full_name, created_at"

export function isUserRole(value: string | null | undefined): value is UserRole {
  return !!value && USER_ROLES.includes(value as UserRole)
}

export function hasAppAccess(role: string | null | undefined): role is ApprovedRole {
  return !!role && (APPROVED_ROLES as readonly string[]).includes(role)
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin"
}

export function getRoleLabel(role: UserRole | string | null | undefined): string {
  switch (role) {
    case "pending":
      return "Pending approval"
    case "employee":
      return "Employee"
    case "manager":
      return "Manager"
    case "admin":
      return "Admin"
    default:
      return "Unknown"
  }
}
