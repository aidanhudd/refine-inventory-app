"use client"

import { ChangeEvent } from "react"
import ItemDimensionsFields from "./ItemDimensionsFields"
import ItemHoldStatus from "./ItemHoldStatus"
import InventoryItemActions from "./InventoryItemActions"
import { Badge } from "./ui"
import { useHidePrices } from "./HidePricesProvider"
import { isItemOnHold } from "../../lib/itemHold"
import type {
  InventoryItemCardCategory,
  InventoryItemCardDraft,
  InventoryItemCardItem,
  InventoryItemCardQuantityType,
  InventoryItemCardSubcategory,
  InventoryItemCardUsage,
} from "./InventoryItemCard"

export type InventoryItemDetailProps = {
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
  canUndoUsage?: (usage: InventoryItemCardUsage) => boolean
  undoingUsageId?: string | null
  onUpdateDraft: (key: keyof InventoryItemCardDraft, value: string) => void
  onSave: () => void
  onCancel: () => void
  onStartEdit: () => void
  onMarkSold: () => void
  onUndoMarkSold: () => void
  onDelete: () => void
  onUse: () => void
  onHold: () => void
  onReleaseHold: () => void
  onUndoUsage: (usageId: string, qty: number) => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
  onPhotoClick: (url: string) => void
  onPhotoDelete: (url: string) => void
  suppressPhotoGallery?: boolean
  className?: string
}

export default function InventoryItemDetail({
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
  canUndoUsage,
  undoingUsageId,
  onUpdateDraft,
  onSave,
  onCancel,
  onStartEdit,
  onMarkSold,
  onUndoMarkSold,
  onDelete,
  onUse,
  onHold,
  onReleaseHold,
  onUndoUsage,
  onUploadPhotos,
  onPhotoClick,
  onPhotoDelete,
  suppressPhotoGallery = false,
  className = "",
}: InventoryItemDetailProps) {
  const { hidePrices } = useHidePrices()
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
  const itemOnHold = isItemOnHold(item.hold_last_name, item.hold_customer_id, item.hold_job_id)

  return (
    <div className={["inventory-item-detail", className].filter(Boolean).join(" ")}>
      <ItemHoldStatus holdLastName={item.hold_last_name} />

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
                {categoryName && <Badge>{categoryName}</Badge>}
                {subcategoryName && <Badge>{subcategoryName}</Badge>}
              </>
            )}
            <Badge>{item.sku || "No SKU"}</Badge>
          </div>
        </div>
        {!hidePrices && (
          <div className="item-price">
            <div className="small item-price-label">Unit Cost</div>
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
        )}
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

      <ItemDimensionsFields
        categoryId={isInlineEditing && inlineDraft ? inlineDraft.category_id : item.category_id || ""}
        categories={categories}
        lengthInches={isInlineEditing && inlineDraft ? inlineDraft.length_inches : ""}
        widthInches={isInlineEditing && inlineDraft ? inlineDraft.width_inches : ""}
        squareFeet={isInlineEditing && inlineDraft ? inlineDraft.square_feet : ""}
        isEditing={!!(isInlineEditing && inlineDraft)}
        onUpdate={onUpdateDraft}
        storedLengthInches={item.length_inches}
        storedWidthInches={item.width_inches}
        storedSquareFeet={item.square_feet}
      />

      <div className="meta-grid">
        {!hidePrices && (
          <div>
            <strong>Total Value:</strong> {formatCurrency(displayTotalValue)}
          </div>
        )}
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
            <div key={usage.id} className="inventory-usage-row">
              <span>
                • {usage.job_name || "No Job"} — {usage.quantity_used || 0} {item.quantity_type || ""} —{" "}
                {usage.used_at ? new Date(usage.used_at).toLocaleDateString() : ""}
              </span>
              {(!canUndoUsage || canUndoUsage(usage)) && (
                <button
                  type="button"
                  className="inventory-usage-undo-btn"
                  disabled={!!undoingUsageId}
                  onClick={() => {
                    if (undoingUsageId) return
                    const confirmed = confirm("Undo this usage?")
                    if (!confirmed) return
                    onUndoUsage(usage.id, Number(usage.quantity_used || 0))
                  }}
                >
                  {undoingUsageId === usage.id ? "Undoing..." : "Undo"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {photos.length > 0 && !suppressPhotoGallery && (
        <div className="section-gap">
          <label>Photos</label>
          <div className="photo-grid">
            {photos.slice(0, 6).map((url) => (
              <div key={url} className="photo-box inventory-photo-box">
                <button
                  type="button"
                  className="inventory-photo-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    const confirmed = confirm("Delete this photo?")
                    if (!confirmed) return
                    onPhotoDelete(url)
                  }}
                >
                  ×
                </button>
                <img
                  src={url}
                  alt="Inventory item"
                  className="inventory-photo-thumb"
                  onClick={() => onPhotoClick(url)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <InventoryItemActions
        isInlineEditing={isInlineEditing}
        itemOnHold={itemOnHold}
        showSoldUndo={showSoldUndo}
        inlineSaving={inlineSaving}
        isUploadingPhotos={isUploadingPhotos}
        onEdit={onStartEdit}
        onSave={onSave}
        onCancel={onCancel}
        onUse={onUse}
        onHold={onHold}
        onReleaseHold={onReleaseHold}
        onMarkSold={onMarkSold}
        onUndoMarkSold={onUndoMarkSold}
        onDelete={onDelete}
        onUploadPhotos={onUploadPhotos}
      />

      <div className="section-gap inventory-photo-status">
        <div className="small">
          {isUploadingPhotos ? "Uploading..." : photos.length ? `${photos.length} photo(s)` : "No photos yet."}
        </div>
      </div>
    </div>
  )
}
