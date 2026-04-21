"use client"
<main style={{ padding: "20px" }}>
  <NavBar />

import { useEffect, useState, useMemo } from "react"
import { supabase } from "../../lib/supabaseClient"
import Link from "next/link"
import NavBar from "../components/NavBar"

type UsageRow = {
  id: string
  item_id: string
  job_name: string | null
  quantity_used: number | null
  used_at: string | null
}

type Item = {
  id: string
  product_name: string | null
  quantity_type: string | null
  unit_cost: number | null
}

export default function JobsPage() {
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [search, setSearch] = useState("")

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    const [usageRes, itemsRes] = await Promise.all([
      supabase.from("inventory_usage").select("*").order("used_at", { ascending: false }),
      supabase.from("inventory_items").select("*"),
    ])

    setUsage(usageRes.data || [])
    setItems(itemsRes.data || [])
  }

  const jobGroups = useMemo(() => {
    const grouped: Record<string, UsageRow[]> = {}

    usage.forEach((u) => {
      const key = u.job_name || "No Job"
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(u)
    })

    return Object.entries(grouped).filter(([job]) =>
      job.toLowerCase().includes(search.toLowerCase())
    )
  }, [usage, search])

  return (
    <main style={{ padding: "20px" }}>
      <h1>Job Material Usage</h1>
      <Link href="/">
  <button style={{ marginBottom: "16px" }}>
    ← Back to Inventory
  </button>
</Link>
      <input
        placeholder="Search jobs..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: "20px", padding: "6px", width: "300px" }}
      />

      {jobGroups.length === 0 ? (
        <div>No usage yet.</div>
      ) : (
        jobGroups.map(([job, entries]) => {
          let total = 0

          return (
            <div
              key={job}
              style={{
                border: "1px solid #ccc",
                padding: "12px",
                marginBottom: "16px",
              }}
            >
              <h3>{job}</h3>

              {entries.map((u) => {
                const item = items.find((i) => i.id === u.item_id)
                const cost = Number(item?.unit_cost || 0)
                const value = cost * Number(u.quantity_used || 0)

                total += value

                return (
                  <div key={u.id} style={{ fontSize: "13px" }}>
                    • {item?.product_name || "Item"} — {u.quantity_used}{" "}
                    {item?.quantity_type} — ${value.toFixed(0)}
                  </div>
                )
              })}

              <div style={{ marginTop: "10px", fontWeight: "bold" }}>
                Total: ${total.toFixed(0)}
              </div>
            </div>
          )
        })
      )}
    </main>
  )
}
