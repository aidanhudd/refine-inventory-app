"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const ADMIN_LINKS = [
  { href: "/admin/users", label: "User Access" },
  { href: "/admin/appearance", label: "Appearance" },
] as const

export default function AdminSubNav() {
  const pathname = usePathname()

  return (
    <nav className="admin-subnav" aria-label="Admin sections">
      {ADMIN_LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "admin-subnav-link admin-subnav-link-active" : "admin-subnav-link"}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
