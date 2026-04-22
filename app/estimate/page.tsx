"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../../lib/supabaseClient"

type InventoryItem = {
  id: string
  product_name: string | null
  unit_cost: number | null
  quantity_type: string | null
}

type EstimateLine = {
  id: string
  inventoryItemId: string
  name: string
  quantity: string
  unitCost: string
}

const createLine = (id: string): EstimateLine => ({
  id,
  inventoryItemId: "",
  name: "",
  quantity: "",
  unitCost: "",
})

const toNumber = (value: string) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const currency = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" })

export default function EstimatePage() {
  const [jobName, setJobName] = useState("")
  const [clientName, setClientName] = useState("")
  const [lines, setLines] = useState<EstimateLine[]>([createLine("1")])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    const loadInventory = async () => {
      setLoadingItems(true)
      setLoadError("")

      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, product_name, unit_cost, quantity_type")
        .order("product_name", { ascending: true })

      if (error) {
        setLoadError(error.message)
      } else {
        setInventoryItems((data as InventoryItem[]) || [])
      }

      setLoadingItems(false)
    }

    loadInventory()
  }, [])

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + toNumber(line.quantity) * toNumber(line.unitCost), 0),
    [lines]
  )

  const updateLine = (id: string, key: keyof EstimateLine, value: string) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [key]: value } : line)))
  }

  const applyInventoryItemToLine = (lineId: string, inventoryItemId: string) => {
    const item = inventoryItems.find((inv) => inv.id === inventoryItemId)
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line
        if (!item) return { ...line, inventoryItemId }

        return {
          ...line,
          inventoryItemId: item.id,
          name: item.product_name || line.name,
          unitCost: item.unit_cost !== null ? String(item.unit_cost) : line.unitCost,
        }
      })
    )
  }

  const addLine = () => setLines((prev) => [...prev, createLine(crypto.randomUUID())])
  const removeLine = (id: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== id)))

  return (
    <main>
      <h1>Estimate Builder</h1>
      <p className="subtext" style={{ marginBottom: "16px" }}>
        Build a quick material estimate and total before creating the final proposal.
      </p>

      <section className="card form-grid">
        <div className="field">
          <label>Job Name</label>
          <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="Kitchen Remodel" />
        </div>
        <div className="field">
          <label>Client Name</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Smith Family" />
        </div>
      </section>

      <section className="card section-gap">
        <h2 style={{ marginBottom: "12px" }}>Line Items</h2>
        {loadError && <div className="notice">Could not load inventory products: {loadError}</div>}
        <div className="list">
          {lines.map((line) => {
            const lineTotal = toNumber(line.quantity) * toNumber(line.unitCost)
            const selectedInventoryItem = inventoryItems.find((item) => item.id === line.inventoryItemId)
            return (
              <div key={line.id} className="item-card">
                <div className="form-grid">
                  <div className="field">
                    <label>Choose From Inventory</label>
                    <select
                      value={line.inventoryItemId}
                      onChange={(e) => applyInventoryItemToLine(line.id, e.target.value)}
                      disabled={loadingItems}
                    >
                      <option value="">
                        {loadingItems ? "Loading products..." : "Select inventory product (optional)"}
                      </option>
                      {inventoryItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.product_name || "Unnamed product"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Material / Item</label>
                    <input
                      value={line.name}
                      onChange={(e) => updateLine(line.id, "name", e.target.value)}
                      placeholder="Quartz slab"
                    />
                  </div>
                  <div className="field">
                    <label>Quantity</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.id, "quantity", e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="field">
                    <label>Unit Cost ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost}
                      onChange={(e) => updateLine(line.id, "unitCost", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                {selectedInventoryItem?.quantity_type && (
                  <p className="small">Unit type: {selectedInventoryItem.quantity_type}</p>
                )}
                <div className="action-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Line Total: {currency(lineTotal)}</strong>
                  <button className="btn-secondary btn-small" onClick={() => removeLine(line.id)} type="button">
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="action-row">
          <button className="btn-primary btn-small" type="button" onClick={addLine}>
            Add Item
          </button>
        </div>
      </section>

      <section className="card section-gap">
        <h2 style={{ marginBottom: "10px" }}>Estimate Summary</h2>
        <p>
          <strong>Job:</strong> {jobName || "Not set"}
        </p>
        <p>
          <strong>Client:</strong> {clientName || "Not set"}
        </p>
        <p style={{ marginTop: "10px" }}>
          <strong>Subtotal:</strong> {currency(subtotal)}
        </p>
      </section>
    </main>
  )
}