"use client"

import InventoryItemCard, {
  type InventoryItemCardCategory,
  type InventoryItemCardDraft,
  type InventoryItemCardItem,
  type InventoryItemCardQuantityType,
  type InventoryItemCardSubcategory,
  type InventoryItemCardUsage,
} from "./InventoryItemCard"
import { ChangeEvent } from "react"

type CategoryExpandedItemPanelProps = {
  item: InventoryItemCardItem
  photos: string[]
  categoryName: string
  subcategoryName: string
  isInlineEditing: boolean
  inlineDraft: InventoryItemCardDraft | null
  inlineSaving: boolean
  categories: InventoryItemCardCategory[]
  subcategories: InventoryItemCardSubcategory[]
  quantityTypes: InventoryItemCardQuantityType[]
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
  onClose: () => void
}

export default function CategoryExpandedItemPanel({
  photos,
  onPhotoClick,
  onPhotoDelete,
  onClose,
  isInlineEditing,
  ...cardProps
}: CategoryExpandedItemPanelProps) {
  const primaryPhoto = photos[0]

  return (
    <div className="category-expanded-card">
      <div className="category-expanded-card-toolbar">
        <button type="button" className="btn-secondary btn-small" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="category-expanded-layout">
        <div className="category-expanded-photo">
          <button
            type="button"
            className="category-grid-card-photo-wrap category-expanded-photo-hero"
            onClick={() => primaryPhoto && onPhotoClick(primaryPhoto)}
            disabled={!primaryPhoto}
            aria-label={primaryPhoto ? "View full-size photo" : "No photo available"}
          >
            {primaryPhoto ? (
              <img src={primaryPhoto} alt="" className="category-grid-card-photo" />
            ) : (
              <span className="category-grid-card-photo-empty">No photo</span>
            )}
            {photos.length > 1 && <span className="category-grid-card-photo-count">+{photos.length - 1}</span>}
          </button>

          {photos.length > 1 && (
            <div className="category-expanded-photo-thumbs">
              {photos.map((url) => (
                <div key={url} className="category-expanded-photo-thumb">
                  <button
                    type="button"
                    className="category-expanded-photo-thumb-delete"
                    aria-label="Delete photo"
                    onClick={(e) => {
                      e.stopPropagation()
                      const confirmed = confirm("Delete this photo?")
                      if (!confirmed) return
                      onPhotoDelete(url)
                    }}
                  >
                    ×
                  </button>
                  <button type="button" className="category-expanded-photo-thumb-btn" onClick={() => onPhotoClick(url)}>
                    <img src={url} alt="" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="category-expanded-details">
          <InventoryItemCard
            {...cardProps}
            photos={photos}
            isInlineEditing={isInlineEditing}
            onPhotoClick={onPhotoClick}
            onPhotoDelete={onPhotoDelete}
            suppressPhotoGallery
          />
        </div>
      </div>
    </div>
  )
}
