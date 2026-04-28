"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import NavBar from "./NavBar"
import { useAuth } from "./AuthProvider"

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  const isLoginRoute = pathname === "/login"

  useEffect(() => {
    if (loading) return
    if (!user && !isLoginRoute) {
      router.replace("/login")
      return
    }
    if (user && isLoginRoute) {
      router.replace("/")
    }
  }, [loading, user, isLoginRoute, router])

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
