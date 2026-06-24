"use client"

import { ChangeEvent, useRef } from "react"
import type { InventoryItemCardItem } from "./InventoryItemCard"

type InventoryCategoryGridCardProps = {
  item: InventoryItemCardItem
  categoryName: string
  subcategoryName: string
  photos: string[]
  formatCurrency: (value: number) => string
  isUploadingPhotos: boolean
  onStartEdit: () => void
  onMarkSold: () => void
  onDelete: () => void
  onUse: () => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
  onPhotoClick: (url: string) => void
}

export default function InventoryCategoryGridCard({
  item,
  categoryName,
  subcategoryName,
  photos,
  formatCurrency,
  isUploadingPhotos,
  onStartEdit,
  onMarkSold,
  onDelete,
  onUse,
  onUploadPhotos,
  onPhotoClick,
}: InventoryCategoryGridCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const primaryPhoto = photos[0]
  const statusLabel = (item.status || "active").replace(/_/g, " ")
  const qty = Number(item.quantity_on_hand || 0)
  const unitCost = Number(item.unit_cost || 0)

  return (
    <article className="category-grid-card">
      <button
        type="button"
        className="category-grid-card-photo-wrap"
        onClick={() => primaryPhoto && onPhotoClick(primaryPhoto)}
        disabled={!primaryPhoto}
        aria-label={primaryPhoto ? `View photo for ${item.product_name || "item"}` : "No photo available"}
      >
        {primaryPhoto ? (
          <img src={primaryPhoto} alt={item.product_name || "Inventory item"} className="category-grid-card-photo" />
        ) : (
          <span className="category-grid-card-photo-empty">No photo</span>
        )}
        {photos.length > 1 && <span className="category-grid-card-photo-count">+{photos.length - 1}</span>}
      </button>

      <div className="category-grid-card-body">
        <h4 className="category-grid-card-name">{item.product_name || "Untitled Item"}</h4>

        <div className="category-grid-card-badges">
          {categoryName && <span className="badge">{categoryName}</span>}
          {subcategoryName && <span className="badge">{subcategoryName}</span>}
        </div>

        <dl className="category-grid-card-meta">
          <div>
            <dt>Qty</dt>
            <dd>
              {qty}
              {item.quantity_type ? ` ${item.quantity_type}` : ""}
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{formatCurrency(unitCost)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className={`category-grid-card-status category-grid-card-status-${(item.status || "active").toLowerCase()}`}>
              {statusLabel}
            </dd>
          </div>
        </dl>

        <div className="category-grid-card-actions">
          <button type="button" className="btn-edit btn-small" onClick={onStartEdit}>
            Edit
          </button>
          <button type="button" className="btn-secondary btn-small" onClick={onUse}>
            Use
          </button>
          <button type="button" className="btn-secondary btn-small" onClick={onMarkSold}>
            Sold
          </button>
          <button type="button" className="btn-danger btn-small" onClick={onDelete}>
            Delete
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={isUploadingPhotos}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploadingPhotos ? "Uploading…" : "Photo"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="category-grid-card-file-input"
            onChange={onUploadPhotos}
          />
        </div>
      </div>
    </article>
  )
}
