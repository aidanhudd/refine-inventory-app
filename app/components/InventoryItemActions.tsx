"use client"

import { ChangeEvent, KeyboardEvent, MouseEvent, useRef } from "react"
import { Button } from "./ui"
import {
  DEFAULT_INVENTORY_CARD_ACTION_ORDER,
  inventoryActionLabel,
  inventoryActionVariant,
  isInventoryActionVisible,
  type InventoryActionLabelMode,
  type InventoryCardActionId,
} from "../../lib/inventoryCardActions"

export type InventoryItemActionsProps = {
  isInlineEditing: boolean
  itemOnHold: boolean
  showSoldUndo: boolean
  inlineSaving?: boolean
  isUploadingPhotos?: boolean
  labelMode?: InventoryActionLabelMode
  order?: InventoryCardActionId[]
  className?: string
  /** Stop propagation so category grid cards do not open on action click/key. */
  stopCardActivation?: boolean
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
  onUse: () => void
  onHold: () => void
  onReleaseHold: () => void
  onMarkSold: () => void
  onUndoMarkSold: () => void
  onDelete: () => void
  onUploadPhotos: (e: ChangeEvent<HTMLInputElement>) => void
}

const stopActivation = (e: MouseEvent | KeyboardEvent) => {
  e.stopPropagation()
}

export default function InventoryItemActions({
  isInlineEditing,
  itemOnHold,
  showSoldUndo,
  inlineSaving = false,
  isUploadingPhotos = false,
  labelMode = "full",
  order = DEFAULT_INVENTORY_CARD_ACTION_ORDER,
  className = "",
  stopCardActivation = false,
  onEdit,
  onSave,
  onCancel,
  onUse,
  onHold,
  onReleaseHold,
  onMarkSold,
  onUndoMarkSold,
  onDelete,
  onUploadPhotos,
}: InventoryItemActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visibilityState = { isInlineEditing, itemOnHold, showSoldUndo }

  const run = (handler: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (stopCardActivation) stopActivation(e)
    handler()
  }

  const handlers: Record<InventoryCardActionId, (() => void) | null> = {
    edit: onEdit,
    save: onSave,
    cancel: onCancel,
    use: onUse,
    hold: onHold,
    releaseHold: onReleaseHold,
    addPhotos: () => fileInputRef.current?.click(),
    markSold: onMarkSold,
    undoMarkSold: onUndoMarkSold,
    delete: onDelete,
  }

  const disabledFor = (id: InventoryCardActionId): boolean => {
    if (id === "save" || id === "cancel") return inlineSaving
    if (id === "addPhotos") return isUploadingPhotos
    return false
  }

  return (
    <div
      className={["action-row", "inventory-item-actions", className].filter(Boolean).join(" ")}
      onClick={stopCardActivation ? stopActivation : undefined}
      onKeyDown={stopCardActivation ? stopActivation : undefined}
    >
      {order.map((id) => {
        if (!isInventoryActionVisible(id, visibilityState)) return null
        const handler = handlers[id]
        if (!handler) return null
        return (
          <Button
            key={id}
            type="button"
            variant={inventoryActionVariant(id)}
            size="sm"
            disabled={disabledFor(id)}
            onClick={run(handler)}
          >
            {inventoryActionLabel(id, { labelMode, inlineSaving, isUploadingPhotos })}
          </Button>
        )
      })}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="inventory-item-actions-file-input"
        onChange={onUploadPhotos}
        onClick={stopCardActivation ? stopActivation : undefined}
      />
    </div>
  )
}
