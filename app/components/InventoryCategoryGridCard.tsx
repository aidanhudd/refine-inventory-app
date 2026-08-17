"use client"

import { ChangeEvent, KeyboardEvent } from "react"
import type { InventoryItemCardItem } from "./InventoryItemCard"
import InventoryItemActions from "./InventoryItemActions"
import { Badge } from "./ui"
import {
  categorySupportsDimensions,
  formatDimensionsSizeLine,
  formatDimensionsSquareFeetLine,
} from "../../lib/inventoryDimensions"
import { useHidePrices } from "./HidePricesProvider"
import ItemHoldStatus from "./ItemHoldStatus"
import { isItemOnHold } from "../../lib/itemHold"

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
  onHold: () => void
  onReleaseHold: () => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
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
  onHold,
  onReleaseHold,
  onUploadPhotos,
}: InventoryCategoryGridCardProps) {
  const { hidePrices } = useHidePrices()
  const primaryPhoto = photos[0]
  const statusLabel = (item.status || "active").replace(/_/g, " ")
  const qty = Number(item.quantity_on_hand || 0)
  const unitCost = Number(item.unit_cost || 0)
  const itemOnHold = isItemOnHold(item.hold_last_name, item.hold_customer_id, item.hold_job_id)

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
        <ItemHoldStatus holdLastName={item.hold_last_name} compact />

        <h4 className="category-grid-card-name">{item.product_name || "Untitled Item"}</h4>

        <div className="category-grid-card-badges">
          {categoryName && <Badge>{categoryName}</Badge>}
          {subcategoryName && <Badge>{subcategoryName}</Badge>}
        </div>

        <dl className="category-grid-card-meta">
          <div>
            <dt>Qty</dt>
            <dd>
              {qty}
              {item.quantity_type ? ` ${item.quantity_type}` : ""}
            </dd>
          </div>
          {!hidePrices && (
            <div>
              <dt>Price</dt>
              <dd>{formatCurrency(unitCost)}</dd>
            </div>
          )}
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

        <InventoryItemActions
          className="category-grid-card-actions"
          labelMode="compact"
          isInlineEditing={false}
          itemOnHold={itemOnHold}
          showSoldUndo={false}
          isUploadingPhotos={isUploadingPhotos}
          stopCardActivation
          onEdit={onStartEdit}
          onSave={() => undefined}
          onCancel={() => undefined}
          onUse={onUse}
          onHold={onHold}
          onReleaseHold={onReleaseHold}
          onMarkSold={onMarkSold}
          onUndoMarkSold={() => undefined}
          onDelete={onDelete}
          onUploadPhotos={onUploadPhotos}
        />
      </div>
    </article>
  )
}
