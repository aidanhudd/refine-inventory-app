"use client"

import { supabase } from "../../lib/supabaseClient"
import { useAuth } from "../components/AuthProvider"
import { getRoleLabel } from "../../lib/profiles"

export default function PendingPage() {
  const { user, profile } = useAuth()

  return (
    <main>
      <section className="card pending-card">
        <h2>Account pending approval</h2>
        <p className="subtext">
          Your account was created successfully, but an administrator must approve it before you can
          access inventory, jobs, and estimates.
        </p>

        <div className="pending-meta">
          <div>
            <strong>Signed in as:</strong> {user?.email || "Unknown"}
          </div>
          <div>
            <strong>Current status:</strong> {getRoleLabel(profile?.role || "pending")}
          </div>
        </div>

        <p className="small">
          Ask an admin to approve your account and assign a role of employee, manager, or admin.
        </p>

        <button
          type="button"
          className="btn-secondary btn-small"
          onClick={() => {
            void supabase.auth.signOut()
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  )
}
