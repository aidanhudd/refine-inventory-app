"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../../lib/supabaseClient"
import { useAuth } from "../../components/AuthProvider"
import {
  ASSIGNABLE_ROLES,
  getRoleLabel,
  isUserRole,
  PROFILE_SELECT,
  type ApprovedRole,
  type Profile,
} from "../../../lib/profiles"

export default function AdminUsersPage() {
  const { user, profile, refreshProfile } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [message, setMessage] = useState("")
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  const loadProfiles = async () => {
    setLoading(true)
    setErrorMessage("")

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .order("created_at", { ascending: false })

    if (error) {
      setErrorMessage(error.message)
      setProfiles([])
      setLoading(false)
      return
    }

    setProfiles(
      (data || []).map((row) => ({
        id: row.id,
        email: row.email ?? null,
        role: isUserRole(row.role) ? row.role : "pending",
        approved_at: row.approved_at ?? null,
        approved_by: row.approved_by ?? null,
        full_name: row.full_name ?? null,
        created_at: row.created_at ?? null,
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  const updateUserRole = async (targetProfile: Profile, nextRole: ApprovedRole | "pending") => {
    setSavingUserId(targetProfile.id)
    setErrorMessage("")
    setMessage("")

    const payload =
      nextRole === "pending"
        ? {
            role: "pending",
            approved_at: null,
            approved_by: null,
          }
        : {
            role: nextRole,
            approved_at: new Date().toISOString(),
            approved_by: user?.id ?? null,
          }

    const { error } = await supabase.from("profiles").update(payload).eq("id", targetProfile.id)

    if (error) {
      setErrorMessage(error.message)
      setSavingUserId(null)
      return
    }

    setMessage(
      nextRole === "pending"
        ? `${targetProfile.email || "User"} moved back to pending approval.`
        : `${targetProfile.email || "User"} approved as ${getRoleLabel(nextRole).toLowerCase()}.`,
    )

    await loadProfiles()
    if (targetProfile.id === user?.id) {
      await refreshProfile()
    }
    setSavingUserId(null)
  }

  return (
    <main>
      <section className="card">
        <h2>User access</h2>
        <p className="subtext">
          Approve new signups and assign roles. New accounts start as pending and cannot access
          inventory until approved.
        </p>

        {message && <div className="success page-feedback">{message}</div>}
        {errorMessage && <div className="notice page-feedback">{errorMessage}</div>}

        {loading ? (
          <div className="empty">Loading users...</div>
        ) : profiles.length === 0 ? (
          <div className="empty">No profiles found.</div>
        ) : (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Approved</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((row) => {
                  const isSelf = row.id === user?.id
                  const isSaving = savingUserId === row.id

                  return (
                    <tr key={row.id}>
                      <td>{row.email || "—"}</td>
                      <td>{row.full_name || "—"}</td>
                      <td>
                        <span className={`role-badge role-badge-${row.role}`}>
                          {getRoleLabel(row.role)}
                        </span>
                      </td>
                      <td>
                        {row.approved_at ? new Date(row.approved_at).toLocaleDateString() : "Not approved"}
                      </td>
                      <td>
                        <div className="admin-user-actions">
                          {row.role === "pending" && (
                            <button
                              type="button"
                              className="btn-primary btn-small"
                              disabled={isSaving}
                              onClick={() => void updateUserRole(row, "employee")}
                            >
                              {isSaving ? "Saving..." : "Approve as employee"}
                            </button>
                          )}

                          <select
                            className="inline-input admin-role-select"
                            value={row.role}
                            disabled={isSaving || (isSelf && row.role === "admin")}
                            onChange={(e) => {
                              const value = e.target.value
                              if (!isUserRole(value)) return
                              if (value === "pending") {
                                void updateUserRole(row, "pending")
                                return
                              }
                              void updateUserRole(row, value)
                            }}
                          >
                            <option value="pending">Pending</option>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {getRoleLabel(role)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="small section-gap">
          Signed in as admin: {profile?.email || user?.email}
        </p>
      </section>
    </main>
  )
}
