"use client"

import { ChangeEvent, KeyboardEvent, MouseEvent, useRef } from "react"
import type { InventoryItemCardItem } from "./InventoryItemCard"
import { categorySupportsDimensions, formatDimensionsSizeLine, formatDimensionsSquareFeetLine } from "../../lib/inventoryDimensions"

type InventoryCategoryGridCardProps = {
  item: InventoryItemCardItem
  categoryName: string
  subcategoryName: string
  photos: string[]
  formatCurrency: (value: number) => string
  isUploadingPhotos: boolean
  onOpenDetail: () => void
  onStartEdit: () => void
  onMarkSold: () => void
  onDelete: () => void
  onUse: () => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
}

const stopClick = (e: MouseEvent | KeyboardEvent) => {
  e.stopPropagation()
}

export default function InventoryCategoryGridCard({
  item,
  categoryName,
  subcategoryName,
  photos,
  formatCurrency,
  isUploadingPhotos,
  onOpenDetail,
  onStartEdit,
  onMarkSold,
  onDelete,
  onUse,
  onUploadPhotos,
}: InventoryCategoryGridCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const primaryPhoto = photos[0]
  const statusLabel = (item.status || "active").replace(/_/g, " ")
  const qty = Number(item.quantity_on_hand || 0)
  const unitCost = Number(item.unit_cost || 0)

  const handleCardKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onOpenDetail()
    }
  }

  return (
    <article
      className="category-grid-card category-grid-card-clickable"
      onClick={onOpenDetail}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${item.product_name || "item"}`}
    >
      <div className="category-grid-card-photo-wrap" aria-hidden="true">
        {primaryPhoto ? (
          <img src={primaryPhoto} alt="" className="category-grid-card-photo" />
        ) : (
          <span className="category-grid-card-photo-empty">No photo</span>
        )}
        {photos.length > 1 && <span className="category-grid-card-photo-count">+{photos.length - 1}</span>}
      </div>

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

        {categorySupportsDimensions(categoryName) && (
          <div className="category-grid-card-dimensions">
            <div>{formatDimensionsSizeLine(item.length_inches, item.width_inches)}</div>
            <div>{formatDimensionsSquareFeetLine(item.square_feet)}</div>
          </div>
        )}

        <div className="category-grid-card-actions" onClick={stopClick} onKeyDown={stopClick}>
          <button
            type="button"
            className="btn-edit btn-small"
            onClick={(e) => {
              stopClick(e)
              onStartEdit()
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={(e) => {
              stopClick(e)
              onUse()
            }}
          >
            Use
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={(e) => {
              stopClick(e)
              onMarkSold()
            }}
          >
            Sold
          </button>
          <button
            type="button"
            className="btn-danger btn-small"
            onClick={(e) => {
              stopClick(e)
              onDelete()
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={isUploadingPhotos}
            onClick={(e) => {
              stopClick(e)
              fileInputRef.current?.click()
            }}
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
            onClick={stopClick}
          />
        </div>
      </div>
    </article>
  )
}
