"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabaseClient"

type Category = {
  id: string
  name: string
}

type QuantityType = {
  id: string
  name: string
}

type InventoryItem = {
  id: string
  sku: string | null
  product_name: string | null
  category_id: string | null
  quantity_on_hand: number | null
  quantity_type: string | null
  unit_cost: number | null
  warehouse_location: string | null
  notes: string | null
  status: string | null
  created_at: string | null
}

const defaultForm = {
  sku: "",
  product_name: "",
  category_id: "",
  quantity_on_hand: "1",
  quantity_type: "",
  unit_cost: "",
  warehouse_location: "",
  notes: "",
  status: "active",
}

export default function Home() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [quantityTypes, setQuantityTypes] = useState<QuantityType[]>([])
  const [form, setForm] = useState(defaultForm)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setErrorMessage("")

    const [itemsRes, categoriesRes, quantityTypesRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name", { ascending: true }),
      supabase.from("quantity_types").select("*").order("name", { ascending: true }),
    ])

    if (itemsRes.error) setErrorMessage(itemsRes.error.message)
    if (categoriesRes.error) setErrorMessage(categoriesRes.error.message)
    if (quantityTypesRes.error) setErrorMessage(quantityTypesRes.error.message)

    setItems(itemsRes.data || [])
    setCategories(categoriesRes.data || [])
    setQuantityTypes(quantityTypesRes.data || [])

    setForm((prev) => ({
      ...prev,
      category_id: prev.category_id || categoriesRes.data?.[0]?.id || "",
      quantity_type: prev.quantity_type || quantityTypesRes.data?.[0]?.name || "",
    }))

    setLoading(false)
  }

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((cat) => map.set(cat.id, cat.name))
    return map
  }, [categories])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const categoryName = item.category_id ? categoryNameById.get(item.category_id) || "" : ""
      const haystack = [
        item.sku,
        item.product_name,
        categoryName,
        item.quantity_type,
        item.warehouse_location,
        item.notes,
        item.status,
      ]
        .join(" ")
        .toLowerCase()

      const matchesSearch = !search || haystack.includes(search.toLowerCase())
      const matchesStatus = statusFilter === "all" || (item.status || "").toLowerCase() === statusFilter
      const matchesCategory = categoryFilter === "all" || item.category_id === categoryFilter
      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [items, search, statusFilter, categoryFilter, categoryNameById])

  const totalValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const qty = Number(item.quantity_on_hand || 0)
      const cost = Number(item.unit_cost || 0)
      return sum + qty * cost
    }, 0)
  }, [items])

  const lowStockCount = useMemo(() => {
    return items.filter((item) => Number(item.quantity_on_hand || 0) <= 3).length
  }, [items])

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const addItem = async () => {
    setSaving(true)
    setMessage("")
    setErrorMessage("")

    if (!form.product_name.trim()) {
      setErrorMessage("Product name is required.")
      setSaving(false)
      return
    }

    const payload = {
      sku: form.sku || null,
      product_name: form.product_name,
      category_id: form.category_id || null,
      quantity_on_hand: Number(form.quantity_on_hand || 0),
      quantity_type: form.quantity_type || null,
      unit_cost: Number(form.unit_cost || 0),
      warehouse_location: form.warehouse_location || null,
      notes: form.notes || null,
      status: form.status || "active",
    }

    const { error } = await supabase.from("inventory_items").insert([payload])

    if (error) {
      setErrorMessage(error.message)
      setSaving(false)
      return
    }

    setMessage("Item saved successfully.")
    setForm({
      ...defaultForm,
      category_id: categories[0]?.id || "",
      quantity_type: quantityTypes[0]?.name || "",
    })
    await loadAll()
    setSaving(false)
  }

  return (
    <main>
      <div className="topbar">
        <div>
          <div className="eyebrow">Refine Kitchen & Bath</div>
          <h1>Warehouse Inventory</h1>
          <p className="subtext">
            Upgraded starter with category dropdowns, quantity types, search, filters, and live Supabase data.
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Items</div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Inventory Value</div>
          <div className="stat-value">${Math.round(totalValue).toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Low Stock</div>
          <div className="stat-value">{lowStockCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Categories</div>
          <div className="stat-value">{categories.length}</div>
        </div>
      </div>

      <div className="layout">
        <section className="card">
          <h2>Add Inventory Item</h2>
          <p className="subtext" style={{ marginBottom: "16px" }}>
            This version saves product name, SKU, category, quantity, quantity type, cost, location, notes, and status.
          </p>

          {categories.length === 0 && (
            <div className="notice">
              Your categories table is empty. Add rows like Quartz, Granite, LVP, SPC, Cabinets, etc. in Supabase.
            </div>
          )}

          {quantityTypes.length === 0 && (
            <div className="notice">
              Your quantity_types table is empty. Add rows like slab, box, piece, sq ft, bundle, and pallet in Supabase.
            </div>
          )}

          {message && <div className="success">{message}</div>}
          {errorMessage && <div className="notice">{errorMessage}</div>}

          <div className="form-grid">
            <div className="field">
              <label>Product Name</label>
              <input value={form.product_name} onChange={(e) => handleChange("product_name", e.target.value)} />
            </div>

            <div className="field">
              <label>SKU</label>
              <input value={form.sku} onChange={(e) => handleChange("sku", e.target.value)} />
            </div>

            <div className="field">
              <label>Category</label>
              <select value={form.category_id} onChange={(e) => handleChange("category_id", e.target.value)}>
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Quantity</label>
              <input type="number" value={form.quantity_on_hand} onChange={(e) => handleChange("quantity_on_hand", e.target.value)} />
            </div>

            <div className="field">
              <label>Quantity Type</label>
              <select value={form.quantity_type} onChange={(e) => handleChange("quantity_type", e.target.value)}>
                <option value="">Select quantity type</option>
                {quantityTypes.map((qty) => (
                  <option key={qty.id} value={qty.name}>{qty.name}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Unit Cost</label>
              <input type="number" value={form.unit_cost} onChange={(e) => handleChange("unit_cost", e.target.value)} />
            </div>

            <div className="field">
              <label>Warehouse Location</label>
              <input value={form.warehouse_location} onChange={(e) => handleChange("warehouse_location", e.target.value)} />
            </div>

            <div className="field">
              <label>Status</label>
              <select value={form.status} onChange={(e) => handleChange("status", e.target.value)}>
                <option value="active">active</option>
                <option value="low_stock">low_stock</option>
                <option value="reserved">reserved</option>
                <option value="damaged">damaged</option>
              </select>
            </div>

            <div className="field">
              <label>Notes</label>
              <textarea value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} />
            </div>

            <div className="button-row">
              <button className="btn-primary" onClick={addItem} disabled={saving}>
                {saving ? "Saving..." : "Save Item"}
              </button>
              <button className="btn-secondary" onClick={loadAll}>
                Refresh Data
              </button>
            </div>
          </div>

          <div className="small">
            Current schema uses category_id as a UUID and quantity_type as text, so this app matches that structure.
          </div>
        </section>

        <section>
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search name, SKU, category, location, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">active</option>
              <option value="low_stock">low_stock</option>
              <option value="reserved">reserved</option>
              <option value="damaged">damaged</option>
            </select>
          </div>

          {loading ? (
            <div className="empty">Loading inventory...</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty">No inventory items yet. Add your first item on the left.</div>
          ) : (
            <div className="list">
              {filteredItems.map((item) => {
                const categoryName = item.category_id ? categoryNameById.get(item.category_id) : ""
                const qty = Number(item.quantity_on_hand || 0)
                return (
                  <div key={item.id} className="item-card">
                    <div className="item-top">
                      <div>
                        <div className="item-name">{item.product_name || "Untitled Item"}</div>
                        <div className="badges">
                          {categoryName && <span className="badge">{categoryName}</span>}
                          {item.status && (
                            <span className={qty <= 3 || item.status === "low_stock" ? "badge badge-alert" : "badge"}>
                              {item.status}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <strong>${Number(item.unit_cost || 0).toLocaleString()}</strong>
                      </div>
                    </div>

                    <div className="meta-grid">
                      <div><strong>SKU:</strong> {item.sku || "—"}</div>
                      <div><strong>Quantity:</strong> {qty} {item.quantity_type || ""}</div>
                      <div><strong>Location:</strong> {item.warehouse_location || "—"}</div>
                      <div><strong>Created:</strong> {item.created_at ? new Date(item.created_at).toLocaleDateString() : "—"}</div>
                      <div><strong>Notes:</strong> {item.notes || "—"}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
