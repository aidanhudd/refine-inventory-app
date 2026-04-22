"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export default function NavBar() {
  const pathname = usePathname()

  const linkStyle = (path: string) => ({
    padding: "8px 16px",
    borderRadius: "6px",
    textDecoration: "none",
    fontWeight: "500",
    background: pathname === path ? "#111" : "#eee",
    color: pathname === path ? "white" : "#333",
  })

  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
        marginBottom: "20px",
      }}
    >
      <Link href="/" style={linkStyle("/")}>
        Inventory
      </Link>

      <Link href="/jobs" style={linkStyle("/jobs")}>
        Jobs
      </Link>

      <Link href="/estimate" style={linkStyle("/estimate")}>
        Estimate
      </Link>
 
    </div>
  )
}
