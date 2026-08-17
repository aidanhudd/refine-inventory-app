"use client"

import { ChangeEvent, forwardRef, KeyboardEvent, ReactNode } from "react"
import type { InventoryItemCardItem } from "./InventoryItemCard"
import InventoryItemActions from "./InventoryItemActions"
import { Badge } from "./ui"
import { useAppearance } from "./AppearanceProvider"
import {
  categorySupportsDimensions,
  formatDimensionsSizeLine,
  formatDimensionsSquareFeetLine,
} from "../../lib/inventoryDimensions"
import { useHidePrices } from "./HidePricesProvider"
import ItemHoldStatus from "./ItemHoldStatus"
import { isItemOnHold } from "../../lib/itemHold"
import {
  resolveVisibleInventoryFields,
  type CompactCardFieldId,
} from "../../lib/appearance"

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

const META_COMPACT_FIELDS = new Set<CompactCardFieldId>(["quantity", "unitCost", "status"])

/**
 * Compact category-grid cards:
 * - Full field reordering applies to InventoryItemDetail only.
 * - This card uses the compact-supported subset (holdStatus, productName, photos,
 *   badges, quantity, unitCost, status, dimensions) with relative order from
 *   config.inventory.card.fieldOrder and visibility from hiddenFields.
 * - Does not introduce notes, usage history, created date, or total value.
 */
const InventoryCategoryGridCard = forwardRef<HTMLElement, InventoryCategoryGridCardProps>(
  function InventoryCategoryGridCard(
    {
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
    },
    ref,
  ) {
    const { config } = useAppearance()
    const { hidePrices } = useHidePrices()
    const primaryPhoto = photos[0]
    const statusLabel = (item.status || "active").replace(/_/g, " ")
    const qty = Number(item.quantity_on_hand || 0)
    const unitCost = Number(item.unit_cost || 0)
    const itemOnHold = isItemOnHold(item.hold_last_name, item.hold_customer_id, item.hold_job_id)

    const visibleFields = resolveVisibleInventoryFields({
      fieldOrder: config.inventory.card.fieldOrder,
      hiddenFields: config.inventory.card.hiddenFields,
      isEditing: false,
      mode: "compact",
    }) as CompactCardFieldId[]

    const showPhotos = visibleFields.includes("photos")
    const bodyFields = visibleFields.filter((id) => id !== "photos")

    const handleCardKeyDown = (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        onOpenDetail()
      }
    }

    const renderCompactField = (fieldId: CompactCardFieldId): ReactNode => {
      switch (fieldId) {
        case "holdStatus":
          return <ItemHoldStatus key={fieldId} holdLastName={item.hold_last_name} compact />

        case "productName":
          return (
            <h4 key={fieldId} className="category-grid-card-name">
              {item.product_name || "Untitled Item"}
            </h4>
          )

        case "badges":
          return (
            <div key={fieldId} className="category-grid-card-badges">
              {categoryName && <Badge>{categoryName}</Badge>}
              {subcategoryName && <Badge>{subcategoryName}</Badge>}
            </div>
          )

        case "quantity":
          return (
            <div key={fieldId} className="category-grid-card-meta-item" data-inventory-field="quantity">
              <dt>Qty</dt>
              <dd>
                {qty}
                {item.quantity_type ? ` ${item.quantity_type}` : ""}
              </dd>
            </div>
          )

        case "unitCost":
          if (hidePrices) return null
          return (
            <div key={fieldId} className="category-grid-card-meta-item" data-inventory-field="unitCost">
              <dt>Price</dt>
              <dd>{formatCurrency(unitCost)}</dd>
            </div>
          )

        case "status":
          return (
            <div key={fieldId} className="category-grid-card-meta-item" data-inventory-field="status">
              <dt>Status</dt>
              <dd
                className={`category-grid-card-status category-grid-card-status-${(item.status || "active").toLowerCase()}`}
              >
                {statusLabel}
              </dd>
            </div>
          )

        case "dimensions":
          if (!categorySupportsDimensions(categoryName)) return null
          return (
            <div key={fieldId} className="category-grid-card-dimensions">
              <div>{formatDimensionsSizeLine(item.length_inches, item.width_inches)}</div>
              <div>{formatDimensionsSquareFeetLine(item.square_feet)}</div>
            </div>
          )

        case "photos":
          return null

        default:
          return null
      }
    }

    const bodyNodes: ReactNode[] = []
    let metaBuffer: ReactNode[] = []
    const flushMeta = () => {
      if (metaBuffer.length === 0) return
      bodyNodes.push(
        <dl key={`meta-${bodyNodes.length}`} className="category-grid-card-meta">
          {metaBuffer}
        </dl>,
      )
      metaBuffer = []
    }

    for (const fieldId of bodyFields) {
      const node = renderCompactField(fieldId)
      if (node == null) continue
      if (META_COMPACT_FIELDS.has(fieldId)) {
        metaBuffer.push(node)
      } else {
        flushMeta()
        bodyNodes.push(node)
      }
    }
    flushMeta()

    return (
      <article
        ref={ref}
        className="category-grid-card category-grid-card-clickable"
        onClick={onOpenDetail}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
        aria-label={`View details for ${item.product_name || "item"}`}
        data-inventory-item-id={item.id}
      >
        {showPhotos && (
          <div className="category-grid-card-photo-wrap" aria-hidden="true">
            {primaryPhoto ? (
              <img src={primaryPhoto} alt="" className="category-grid-card-photo" />
            ) : (
              <span className="category-grid-card-photo-empty">No photo</span>
            )}
            {photos.length > 1 && (
              <span className="category-grid-card-photo-count">+{photos.length - 1}</span>
            )}
          </div>
        )}

        <div className="category-grid-card-body">
          {bodyNodes}

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
  },
)

export default InventoryCategoryGridCard
