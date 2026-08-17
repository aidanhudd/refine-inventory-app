"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_LINK_REGISTRY, type NavItemId } from "../../lib/appearance"
import { supabase } from "../../lib/supabaseClient"
import { useAppearance } from "./AppearanceProvider"
import { useAuth } from "./AuthProvider"
import { isAdmin } from "../../lib/profiles"
import HidePricesSwitch from "./HidePricesSwitch"
import { Button } from "./ui"

export default function NavBar() {
  const pathname = usePathname()
  const { user, profile } = useAuth()
  const { config } = useAppearance()
  const admin = isAdmin(profile?.role) && profile?.approved === true

  const linkClass = (path: string) =>
    pathname === path ? "nav-link nav-link-active" : "nav-link"

  if (!user) return null

  const orderedNavIds = config.nav.order.filter((id): id is NavItemId => id in NAV_LINK_REGISTRY)

  return (
    <div className="nav-bar">
      <div className="nav-bar-meta">
        <HidePricesSwitch />
        <div className="small">Signed in as {user.email}</div>
      </div>
      <nav className="nav-links" aria-label="Primary">
        {orderedNavIds.map((id) => {
          const item = NAV_LINK_REGISTRY[id]
          return (
            <Link key={id} href={item.href} className={linkClass(item.href)}>
              {item.label}
            </Link>
          )
        })}

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
