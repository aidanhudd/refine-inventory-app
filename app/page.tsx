"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"

export default function Home() {
  const [items, setItems] = useState<any[]>([])
  const [name, setName] = useState("")
  const [cost, setCost] = useState("")

  useEffect(() => {
    fetchItems()
  }, [])

  const fetchItems = async () => {
    const { data } = await supabase.from("inventory_items").select("*")
    setItems(data || [])
  }

  const addItem = async () => {
    await supabase.from("inventory_items").insert([
      { product_name: name, unit_cost: Number(cost) }
    ])
    setName("")
    setCost("")
    fetchItems()
  }

  return (
    <div>
      <h1>Inventory App</h1>

      <div>
        <input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Cost" value={cost} onChange={(e) => setCost(e.target.value)} />
        <button onClick={addItem}>Add Item</button>
      </div>

      {items.map((item) => (
        <div key={item.id} className="card">
          <strong>{item.product_name}</strong> - ${item.unit_cost}
        </div>
      ))}
    </div>
  )
}
