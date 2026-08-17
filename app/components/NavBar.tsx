"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { supabase } from "../../lib/supabaseClient"
import { useAuth } from "./AuthProvider"
import { isAdmin } from "../../lib/profiles"
import HidePricesSwitch from "./HidePricesSwitch"
import { Button } from "./ui"

export default function NavBar() {
  const pathname = usePathname()
  const { user, profile } = useAuth()
  const admin = isAdmin(profile?.role) && profile?.approved === true

  const linkClass = (path: string) =>
    pathname === path ? "nav-link nav-link-active" : "nav-link"

  if (!user) return null

  return (
    <div className="nav-bar">
      <div className="nav-bar-meta">
        <HidePricesSwitch />
        <div className="small">Signed in as {user.email}</div>
      </div>
      <nav className="nav-links" aria-label="Primary">
        <Link href="/" className={linkClass("/")}>
          Inventory
        </Link>

        <Link href="/jobs" className={linkClass("/jobs")}>
          Jobs
        </Link>

        <Link href="/estimate" className={linkClass("/estimate")}>
          Estimate
        </Link>

        {admin && (
          <Link href="/admin/users" className={linkClass("/admin/users")}>
            Admin
          </Link>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            supabase.auth.signOut()
          }}
        >
          Sign out
        </Button>
      </nav>
    </div>
  )
}
