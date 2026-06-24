"use client"

import { ChangeEvent } from "react"

export type InventoryItemCardCategory = { id: string; name: string }
export type InventoryItemCardSubcategory = { id: string; category_id: string; name: string }
export type InventoryItemCardQuantityType = { id: string; name: string }

export type InventoryItemCardItem = {
  id: string
  sku: string | null
  product_name: string | null
  category_id: string | null
  subcategory_id: string | null
  quantity_on_hand: number | null
  quantity_type: string | null
  unit_cost: number | null
  warehouse_location: string | null
  notes: string | null
  status: string | null
  created_at: string | null
}

export type InventoryItemCardUsage = {
  id: string
  job_name: string | null
  quantity_used: number | null
  used_at: string | null
}

export type InventoryItemCardDraft = {
  product_name: string
  category_id: string
  subcategory_id: string
  quantity_on_hand: string
  quantity_type: string
  unit_cost: string
  warehouse_location: string
  notes: string
}

type InventoryItemCardProps = {
  item: InventoryItemCardItem
  categoryName: string
  subcategoryName: string
  isInlineEditing: boolean
  inlineDraft: InventoryItemCardDraft | null
  inlineSaving: boolean
  categories: InventoryItemCardCategory[]
  subcategories: InventoryItemCardSubcategory[]
  quantityTypes: InventoryItemCardQuantityType[]
  photos: string[]
  itemUsage: InventoryItemCardUsage[]
  showSoldUndo: boolean
  isUploadingPhotos: boolean
  formatCurrency: (value: number) => string
  onUpdateDraft: (key: keyof InventoryItemCardDraft, value: string) => void
  onSave: () => void
  onCancel: () => void
  onStartEdit: () => void
  onMarkSold: () => void
  onUndoMarkSold: () => void
  onDelete: () => void
  onUse: () => void
  onUndoUsage: (usageId: string, qty: number) => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
  onPhotoClick: (url: string) => void
  onPhotoDelete: (url: string) => void
  suppressPhotoGallery?: boolean
}

export default function InventoryItemCard({
  item,
  categoryName,
  subcategoryName,
  isInlineEditing,
  inlineDraft,
  inlineSaving,
  categories,
  subcategories,
  quantityTypes,
  photos,
  itemUsage,
  showSoldUndo,
  isUploadingPhotos,
  formatCurrency,
  onUpdateDraft,
  onSave,
  onCancel,
  onStartEdit,
  onMarkSold,
  onUndoMarkSold,
  onDelete,
  onUse,
  onUndoUsage,
  onUploadPhotos,
  onPhotoClick,
  onPhotoDelete,
  suppressPhotoGallery = false,
}: InventoryItemCardProps) {
  const statusLabel = (item.status || "active").replace(/_/g, " ")
  const displayName = isInlineEditing && inlineDraft ? inlineDraft.product_name : item.product_name
  const displayQty = Number(isInlineEditing && inlineDraft ? inlineDraft.quantity_on_hand : item.quantity_on_hand || 0)
  const displayUnitCost = Number(isInlineEditing && inlineDraft ? inlineDraft.unit_cost : item.unit_cost || 0)
  const displayLocation =
    isInlineEditing && inlineDraft ? inlineDraft.warehouse_location : item.warehouse_location || "—"
  const displayNotes = isInlineEditing && inlineDraft ? inlineDraft.notes : item.notes || "No notes"
  const displayTotalValue = displayQty * displayUnitCost
  const inlineEditSubcategories =
    isInlineEditing && inlineDraft
      ? subcategories.filter((sub) => sub.category_id === inlineDraft.category_id)
      : []

  return (
    <div className="item-card">
      <div className="item-top">
        <div>
          {isInlineEditing && inlineDraft ? (
            <input
              className="inline-input"
              value={inlineDraft.product_name}
              onChange={(e) => onUpdateDraft("product_name", e.target.value)}
              placeholder="Product name"
            />
          ) : (
            <div className="item-name">{displayName || "Untitled Item"}</div>
          )}
          <div className="badges">
            {isInlineEditing && inlineDraft ? (
              <div className="inline-category-fields">
                <select
                  className="inline-input"
                  value={inlineDraft.category_id}
                  onChange={(e) => onUpdateDraft("category_id", e.target.value)}
                  aria-label="Category"
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                <select
                  className="inline-input"
                  value={inlineDraft.subcategory_id}
                  onChange={(e) => onUpdateDraft("subcategory_id", e.target.value)}
                  disabled={!inlineDraft.category_id}
                  aria-label="Subcategory"
                >
                  <option value="">No subcategory</option>
                  {inlineEditSubcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                {categoryName && <span className="badge">{categoryName}</span>}
                {subcategoryName && <span className="badge">{subcategoryName}</span>}
              </>
            )}
            <span className="badge">{item.sku || "No SKU"}</span>
          </div>
        </div>
        <div className="item-price">
          <div className="small" style={{ marginTop: 0 }}>
            Unit Cost
          </div>
          {isInlineEditing && inlineDraft ? (
            <input
              className="inline-input"
              type="number"
              value={inlineDraft.unit_cost}
              onChange={(e) => onUpdateDraft("unit_cost", e.target.value)}
            />
          ) : (
            <strong>{formatCurrency(Number(item.unit_cost || 0))}</strong>
          )}
        </div>
      </div>

      <div className="item-kpis">
        <div className="item-kpi">
          <div className="item-kpi-label">Quantity on Hand</div>
          {isInlineEditing && inlineDraft ? (
            <div className="inline-quantity-fields">
              <input
                className="inline-input"
                type="number"
                value={inlineDraft.quantity_on_hand}
                onChange={(e) => onUpdateDraft("quantity_on_hand", e.target.value)}
              />
              <select
                className="inline-input"
                value={inlineDraft.quantity_type}
                onChange={(e) => onUpdateDraft("quantity_type", e.target.value)}
                aria-label="Quantity type"
              >
                <option value="">Select quantity type</option>
                {quantityTypes.map((qty) => (
                  <option key={qty.id} value={qty.name}>
                    {qty.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="item-kpi-value">
              {displayQty} <span className="item-kpi-unit">{item.quantity_type || ""}</span>
            </div>
          )}
        </div>
        <div className="item-kpi item-kpi-status">
          <div className="item-kpi-label">Location</div>
          {isInlineEditing && inlineDraft ? (
            <input
              className="inline-input"
              value={inlineDraft.warehouse_location}
              onChange={(e) => onUpdateDraft("warehouse_location", e.target.value)}
              placeholder="Warehouse location"
            />
          ) : (
            <div className="item-kpi-value item-status-text">{displayLocation}</div>
          )}
        </div>
      </div>

      <div className="meta-grid">
        <div>
          <strong>Total Value:</strong> {formatCurrency(displayTotalValue)}
        </div>
        <div>
          <strong>Status:</strong> {statusLabel}
        </div>
      </div>

      <div className="meta-grid meta-grid-secondary section-gap">
        <div>
          <strong>Created:</strong> {item.created_at ? new Date(item.created_at).toLocaleDateString() : "—"}
        </div>
        <div>
          <strong>Notes:</strong>{" "}
          {isInlineEditing && inlineDraft ? (
            <textarea
              className="inline-textarea"
              value={inlineDraft.notes}
              onChange={(e) => onUpdateDraft("notes", e.target.value)}
              placeholder="Notes"
            />
          ) : (
            displayNotes
          )}
        </div>
      </div>

      {itemUsage.length > 0 && (
        <div className="section-gap">
          <strong>Usage History</strong>
          {itemUsage.map((usage) => (
            <div
              key={usage.id}
              style={{
                fontSize: "13px",
                marginTop: "4px",
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span>
                • {usage.job_name || "No Job"} — {usage.quantity_used || 0} {item.quantity_type || ""} —{" "}
                {usage.used_at ? new Date(usage.used_at).toLocaleDateString() : ""}
              </span>
              <button
                onClick={() => {
                  const confirmed = confirm("Undo this usage?")
                  if (!confirmed) return
                  onUndoUsage(usage.id, Number(usage.quantity_used || 0))
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
          ))}
        </div>
      )}

      {photos.length > 0 && !suppressPhotoGallery && (
        <div className="section-gap">
          <label>Photos</label>
          <div className="photo-grid">
            {photos.slice(0, 6).map((url) => (
              <div key={url} className="photo-box" style={{ position: "relative" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const confirmed = confirm("Delete this photo?")
                    if (!confirmed) return
                    onPhotoDelete(url)
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
                <img src={url} alt="Inventory item" onClick={() => onPhotoClick(url)} style={{ cursor: "pointer" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="action-row">
        {isInlineEditing ? (
          <>
            <button className="btn-primary btn-small" disabled={inlineSaving} onClick={onSave}>
              {inlineSaving ? "Saving..." : "Save"}
            </button>
            <button className="btn-secondary btn-small" disabled={inlineSaving} onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn-edit btn-small" onClick={onStartEdit}>
            Edit
          </button>
        )}

        <button className="btn-secondary btn-small" onClick={onMarkSold}>
          Mark Sold
        </button>
        {isInlineEditing && showSoldUndo && (
          <button className="btn-secondary btn-small" onClick={onUndoMarkSold}>
            Undo Mark Sold
          </button>
        )}

        <button className="btn-danger btn-small" onClick={onDelete}>
          Delete
        </button>

        <button className="btn-secondary btn-small" onClick={onUse}>
          Use
        </button>
      </div>

      <div className="section-gap">
        <label>Add More Photos</label>
        <input type="file" multiple accept="image/*" onChange={onUploadPhotos} />
        <div className="small">
          {isUploadingPhotos ? "Uploading..." : photos.length ? `${photos.length} photo(s)` : "No photos yet."}
        </div>
      </div>
    </div>
  )
}
