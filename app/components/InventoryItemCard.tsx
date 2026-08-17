"use client"

import { ChangeEvent } from "react"
import InventoryItemDetail from "./InventoryItemDetail"

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
  hold_last_name: string | null
  hold_at: string | null
  hold_customer_id?: string | null
  hold_job_id?: string | null
  created_at: string | null
  length_inches: number | null
  width_inches: number | null
  square_feet: number | null
}

export type InventoryItemCardUsage = {
  id: string
  user_id?: string | null
  job_id?: string | null
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
  length_inches: string
  width_inches: string
  square_feet: string
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
}

export default function InventoryItemCard(props: InventoryItemCardProps) {
  return (
    <div className="item-card">
      <InventoryItemDetail {...props} />
    </div>
  )
}
