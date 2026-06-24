"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import NavBar from "./NavBar"
import { useAuth } from "./AuthProvider"
import { hasAppAccess, isAdmin } from "../../lib/profiles"

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, loading } = useAuth()

  const isLoginRoute = pathname === "/login"
  const isPendingRoute = pathname === "/pending"
  const isAdminRoute = pathname.startsWith("/admin")
  const role = profile?.role ?? "pending"
  const canAccessApp = hasAppAccess(profile)
  const admin = isAdmin(role) && profile?.approved === true

  useEffect(() => {
    if (loading) return

    if (!user && !isLoginRoute) {
      router.replace("/login")
      return
    }

    if (user && isLoginRoute) {
      router.replace(canAccessApp ? "/" : "/pending")
      return
    }

    if (!user) return

    if (!canAccessApp && !isPendingRoute) {
      router.replace("/pending")
      return
    }

    if (canAccessApp && isPendingRoute) {
      router.replace("/")
      return
    }

    if (isAdminRoute && !admin) {
      router.replace("/")
    }
  }, [loading, user, isLoginRoute, isPendingRoute, isAdminRoute, canAccessApp, admin, router])

  if (loading) {
    return (
      <main>
        <div className="empty">Checking your session...</div>
      </main>
    )
  }

  if (!user && !isLoginRoute) return null
  if (user && isLoginRoute) return null

  if (isLoginRoute) {
    return <>{children}</>
  }

  if (isPendingRoute) {
    return <>{children}</>
  }

  return (
    <>
      <div className="app-header-shell">
        <header className="topbar app-header">
          <div className="app-brand">
            <img src="/logo.png" alt="Refine Kitchen & Bath Logo" className="app-logo" />
            <div>
              <h1 className="app-title">Warehouse Inventory</h1>
            </div>
          </div>
          <NavBar />
        </header>
      </div>
      {children}
    </>
  )
}
