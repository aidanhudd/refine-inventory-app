"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export default function NavBar() {
  const pathname = usePathname()

  const linkClass = (path: string) =>
    pathname === path ? "nav-link nav-link-active" : "nav-link"

  return (
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
    </nav>
  )
}
