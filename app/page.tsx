"use client"

import { ChangeEvent, useEffect, useMemo, useState } from "react"
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

type PhotoMap = Record<string, string[]>

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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null)
  const [photoMap, setPhotoMap] = useState<PhotoMap>({})
  const [activeImage, setActiveImage] = useState<string | null>(null)
  const [usageMap, setUsageMap] = useState<Record<string, any[]>>({})
  const [jobMap, setJobMap] = useState<Record<string, any[]>>({})  

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    setErrorMessage("")
    await loadUsage()

    const [itemsRes, categoriesRes, quantityTypesRes] = await Promise.all([
      supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name", { ascending: true }),
      supabase.from("quantity_types").select("*").order("name", { ascending: true }),
    ])

    if (itemsRes.error) setErrorMessage(itemsRes.error.message)
    if (categoriesRes.error) setErrorMessage(categoriesRes.error.message)
    if (quantityTypesRes.error) setErrorMessage(quantityTypesRes.error.message)

    const loadedItems = itemsRes.data || []
    setItems(loadedItems)
    setCategories(categoriesRes.data || [])
    setQuantityTypes(quantityTypesRes.data || [])

    setForm((prev) => ({
      ...prev,
      category_id: prev.category_id || categoriesRes.data?.[0]?.id || "",
      quantity_type: prev.quantity_type || quantityTypesRes.data?.[0]?.name || "",
    }))

    await loadPhotosForItems(loadedItems)
    setLoading(false)
  }

  const loadPhotosForItems = async (loadedItems: InventoryItem[]) => {
    const nextMap: PhotoMap = {}
    for (const item of loadedItems) {
      const { data, error } = await supabase.storage.from("inventory-photos").list(item.id, {
        limit: 12,
        sortBy: { column: "name", order: "asc" },
      })
      if (!error && data) {
        nextMap[item.id] = data.map((file) => {
          const { data: publicUrlData } = supabase.storage
            .from("inventory-photos")
            .getPublicUrl(`${item.id}/${file.name}`)
          return publicUrlData.publicUrl
        })
      }
    }
    setPhotoMap(nextMap)
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

  const soldCount = useMemo(() => {
    return items.filter((item) => (item.status || "").toLowerCase() === "sold").length
  }, [items])

  const lowStockCount = useMemo(() => {
    return items.filter((item) => Number(item.quantity_on_hand || 0) <= 3).length
  }, [items])

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const resetForm = () => {
    setEditingId(null)
    setSelectedFiles([])
    setForm({
      ...defaultForm,
      category_id: categories[0]?.id || "",
      quantity_type: quantityTypes[0]?.name || "",
    })
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setSelectedFiles(files)
  }

  const uploadPhotos = async (itemId: string, files: File[]) => {
    if (!files.length) return
    for (const file of files) {
      const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`
      const { error } = await supabase.storage.from("inventory-photos").upload(`${itemId}/${safeName}`, file, {
        upsert: true,
      })
      if (error) throw error
    }
  }

  const saveItem = async () => {
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

    if (editingId) {
      const { error } = await supabase.from("inventory_items").update(payload).eq("id", editingId)
      if (error) {
        setErrorMessage(error.message)
        setSaving(false)
        return
      }

      try {
        if (selectedFiles.length) {
          await uploadPhotos(editingId, selectedFiles)
        }
        setMessage("Item updated successfully.")
        resetForm()
        await loadAll()
      } catch (uploadError: any) {
        setErrorMessage(`Item updated, but photo upload failed: ${uploadError.message}`)
        await loadAll()
      }

      setSaving(false)
      return
    }

    const { data, error } = await supabase.from("inventory_items").insert([payload]).select().single()

    if (error) {
      setErrorMessage(error.message)
      setSaving(false)
      return
    }

    try {
      if (data?.id && selectedFiles.length) {
        await uploadPhotos(data.id, selectedFiles)
      }
      setMessage("Item saved successfully.")
      resetForm()
      await loadAll()
    } catch (uploadError: any) {
      setErrorMessage(`Item saved, but photo upload failed: ${uploadError.message}`)
      await loadAll()
    }

    setSaving(false)
  }

  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id)
    setMessage("")
    setErrorMessage("")
    setSelectedFiles([])
    setForm({
      sku: item.sku || "",
      product_name: item.product_name || "",
      category_id: item.category_id || "",
      quantity_on_hand: String(item.quantity_on_hand ?? 0),
      quantity_type: item.quantity_type || "",
      unit_cost: String(item.unit_cost ?? 0),
      warehouse_location: item.warehouse_location || "",
      notes: item.notes || "",
      status: item.status || "active",
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const deleteItem = async (id: string) => {
    const confirmed = window.confirm("Delete this item?")
    if (!confirmed) return

    setErrorMessage("")
    setMessage("")

    const { error } = await supabase.from("inventory_items").delete().eq("id", id)
    if (error) {
      setErrorMessage(error.message)
      return
    }

    if (editingId === id) {
      resetForm()
    }

    setMessage("Item deleted.")
    await loadAll()
  }
  
const useInventory = async (itemId: string, qty: number, jobName: string) => {
  // 1. log usage
  await supabase.from("inventory_usage").insert([
    {
      item_id: itemId,
      job_name: jobName,
      quantity_used: qty,
    },
  ])

  // 2. subtract from inventory
  const item = items.find(i => i.id === itemId)

  if (!item) return

  const newQty = Number(item.quantity_on_hand || 0) - qty

  await supabase
    .from("inventory_items")
    .update({ quantity_on_hand: newQty })
    .eq("id", itemId)

  await loadAll()
}
const markSold = async (id: string) => {
  setErrorMessage("")
  setMessage("")

  const { error } = await supabase
    .from("inventory_items")
    .update({ status: "sold", quantity_on_hand: 0 })
    .eq("id", id)

  if (error) {
    setErrorMessage(error.message)
    return
  }

  if (editingId === id) {
    setForm((prev) => ({
      ...prev,
      status: "sold",
      quantity_on_hand: "0",
    }))
  }
  const undoUsage = async (usageId: string, itemId: string, qty: number) => {
  // 1. delete usage log
  const { error } = await supabase
    .from("inventory_usage")
    .delete()
    .eq("id", usageId)

  if (error) {
    alert(error.message)
    return
  }

  // 2. restore inventory
  const item = items.find(i => i.id === itemId)
  if (!item) return

  const newQty = Number(item.quantity_on_hand || 0) + Number(qty)

  await supabase
    .from("inventory_items")
    .update({ quantity_on_hand: newQty })
    .eq("id", itemId)

  await loadAll()
}

  setMessage("Item marked as sold.")
  await loadAll()
}
  

  const uploadMorePhotos = async (itemId: string, e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploadingItemId(itemId)
    setErrorMessage("")
    setMessage("")

    try {
      await uploadPhotos(itemId, files)
      setMessage("Photos uploaded.")
      await loadAll()
    } catch (error: any) {
      setErrorMessage(error.message)
    }

    setUploadingItemId(null)
  }

  const loadUsage = async () => {
  const { data, error } = await supabase
    .from("inventory_usage")
    .select("*")
    .order("used_at", { ascending: false })

  if (error) {
    console.log(error.message)
    return
  }

  const grouped: Record<string, any[]> = {}

  data?.forEach((row) => {
    if (!grouped[row.item_id]) {
      grouped[row.item_id] = []
    }
    grouped[row.item_id].push(row)
  })

  setUsageMap(grouped)
    buildJobMap(data || [])
}
  const buildJobMap = (usage: any[]) => {
  const grouped: Record<string, any[]> = {}

  usage.forEach((row) => {
    if (!grouped[row.job_name]) {
      grouped[row.job_name] = []
    }
    grouped[row.job_name].push(row)
  })

  setJobMap(grouped)
}

  return (
    <main>
      <div className="topbar">
        <div>
          <div className="eyebrow">Refine Kitchen & Bath</div>
          <h1>Warehouse Inventory</h1>
          <p className="subtext">
            Now with edit, sold, delete, photo upload support, and fullscreen image preview.
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
          <div className="stat-label">Sold</div>
          <div className="stat-value">{soldCount}</div>
        </div>
      </div>

      <div className="layout">
        <section className="card">
          <h2>{editingId ? "Edit Inventory Item" : "Add Inventory Item"}</h2>
          <p className="subtext" style={{ marginBottom: "16px" }}>
            {editingId ? "Update an existing item, then save changes." : "Add core product details and optional photos on creation."}
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

          <div className="notice">
            For photos to work, create a Supabase storage bucket named <strong>inventory-photos</strong> and make it public.
          </div>

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
                <option value="sold">sold</option>
              </select>
            </div>

            <div className="field">
              <label>Notes</label>
              <textarea value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} />
            </div>

            <div className="field">
              <label>{editingId ? "Add New Photos While Editing" : "Photos"}</label>
              <input type="file" multiple accept="image/*" onChange={handleFileSelect} />
              <div className="small">{selectedFiles.length ? `${selectedFiles.length} file(s) selected` : "No photos selected yet."}</div>
            </div>

            <div className="button-row">
              <button className="btn-primary" onClick={saveItem} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Save Changes" : "Save Item"}
              </button>
              <button className="btn-secondary" onClick={loadAll}>
                Refresh Data
              </button>
              {editingId && (
                <button className="btn-edit" onClick={resetForm}>
                  Cancel Edit
                </button>
              )}
            </div>
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
              <option value="sold">sold</option>
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
                const photos = photoMap[item.id] || []

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
                    
                    {usageMap[item.id]?.length > 0 && (
  <div className="section-gap">
    <strong>Usage History</strong>

    {usageMap[item.id].slice(0, 5).map((u) => (
      <div key={u.id} style={{ fontSize: "13px", marginTop: "4px", display: "flex", justifyContent: "space-between" }}>
  <span>
    • {u.job_name} — {u.quantity_used} {item.quantity_type} —{" "}
    {new Date(u.used_at).toLocaleDateString()}
  </span>

  <button
    onClick={() => {
      const confirmed = confirm("Undo this usage?")
      if (!confirmed) return

      undoUsage(u.id, item.id, u.quantity_used)
    }}
    style={{
      marginLeft: "8px",
      background: "red",
      color: "white",
      border: "none",
      borderRadius: "4px",
      cursor: "pointer",
      fontSize: "11px",
      padding: "2px 6px",
    }}
  >
    Undo
  </button>
</div>
    }
                    <div className="section-gap">
  <label>Add More Photos</label>
  <input type="file" multiple accept="image/*" onChange={(e) => uploadMorePhotos(item.id, e)} />
  <div className="small">
    {uploadingItemId === item.id ? "Uploading..." : photos.length ? `${photos.length} photo(s)` : "No photos yet."}
  </div>

  {photos.length > 0 && (
    <div className="photo-grid">
      {photos.slice(0, 6).map((url) => {
      const filePath = url
  .split("/storage/v1/object/public/inventory-photos/")[1]
  ?.replace(/"/g, "")
      
        return (
          <div
            key={url}
            className="photo-box"
            style={{ position: "relative" }}
          >
            <button
              onClick={async (e) => {
                e.stopPropagation()

                const confirmed = confirm("Delete this photo?")
                if (!confirmed) return

                const { error } = await supabase
                  .storage
                  .from("inventory-photos")
                  .remove([filePath])

                if (error) {
                  alert(error.message)
                } else {
                  await loadAll()
                }
              }}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                border: "none",
                borderRadius: "50%",
                width: 22,
                height: 22,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ×
            </button>

            <img
              src={url}
              alt="Inventory item"
              onClick={() => setActiveImage(url)}
              style={{ cursor: "pointer" }}
            />
          </div>
        )
      })}
    </div>
  )}
</div>

                   <div className="action-row">
  <button
    className="btn-edit btn-small"
    onClick={() => startEdit(item)}
  >
    Edit
  </button>

  <button
    className="btn-secondary btn-small"
    onClick={() => markSold(item.id)}
  >
    Mark Sold
  </button>

  <button
    className="btn-danger btn-small"
    onClick={() => deleteItem(item.id)}
  >
    Delete
  </button>

  <button
    className="btn-secondary btn-small"
    onClick={async () => {
      const qty = Number(prompt("How much was used?"))
      if (!qty) return

      const job = prompt("Job name?")
      if (!job) return

      await useInventory(item.id, qty, job)
    }}
  >
    Use
  </button> 
  </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {activeImage && (
        <div
          onClick={() => setActiveImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            cursor: "pointer",
            padding: "24px",
          }}
        >
          <img
            src={activeImage}
            alt="Full size inventory"
            style={{
              maxWidth: "95%",
              maxHeight: "95%",
              borderRadius: "12px",
            }}
          />
        </div>
      )}
      <div style={{ marginTop: "40px" }}>
  <h2>Job Material Usage</h2>

  {Object.keys(jobMap).length === 0 ? (
    <div className="empty">No job usage yet.</div>
  ) : (
    Object.entries(jobMap).map(([job, entries]) => {
      let total = 0

      return (
        <div key={job} className="card" style={{ marginBottom: "16px" }}>
          <h3>{job}</h3>

          {entries.map((u) => {
            const item = items.find(i => i.id === u.item_id)
            const cost = Number(item?.unit_cost || 0)
            const value = cost * Number(u.quantity_used)

            total += value

            return (
              <div key={u.id} style={{ fontSize: "13px", marginTop: "4px" }}>
                • {item?.product_name || "Item"} — {u.quantity_used} {item?.quantity_type || ""} — ${value.toFixed(0)}
              </div>
            )
          })}

          <div style={{ marginTop: "8px", fontWeight: "bold" }}>
            Total Material: ${total.toFixed(0)}
          </div>
        </div>
      )
    })
  )}
</div>    </main>
  )
}
