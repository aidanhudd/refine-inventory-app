"use client"

import {
  ChangeEvent,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { Button } from "./ui"
import { useAppearance } from "./AppearanceProvider"
import {
  expandInventoryActionSlot,
  inventoryActionSlotHasVisibleActions,
  type InventoryActionSlotId,
} from "../../lib/appearance"
import {
  inventoryActionLabel,
  inventoryActionVariant,
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
  /** Optional override; defaults to appearance config.inventory.card.actionOrder */
  actionOrder?: InventoryActionSlotId[]
  /** Optional override; defaults to appearance config.inventory.card.moreActions */
  moreActions?: InventoryActionSlotId[]
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
  actionOrder: actionOrderProp,
  moreActions: moreActionsProp,
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
  const { config } = useAppearance()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const moreRootRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const morePanelId = useId()

  const actionOrder = actionOrderProp ?? config.inventory.card.actionOrder
  const moreActions = moreActionsProp ?? config.inventory.card.moreActions
  const visibilityState = { isInlineEditing, itemOnHold, showSoldUndo }

  const visibleMoreSlots = moreActions.filter((slot) =>
    inventoryActionSlotHasVisibleActions(slot, visibilityState),
  )
  const showMoreActions = visibleMoreSlots.length > 0

  useEffect(() => {
    if (!moreOpen) return

    const onDocPointerDown = (event: PointerEvent) => {
      const root = moreRootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setMoreOpen(false)
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false)
      }
    }

    document.addEventListener("pointerdown", onDocPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [moreOpen])

  useEffect(() => {
    if (!showMoreActions && moreOpen) {
      setMoreOpen(false)
    }
  }, [showMoreActions, moreOpen])

  const run = (handler: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (stopCardActivation) stopActivation(e)
    handler()
  }

  const runFromMore = (handler: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (stopCardActivation) stopActivation(e)
    setMoreOpen(false)
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

  const renderActionButton = (
    id: InventoryCardActionId,
    onClick: (e: MouseEvent<HTMLButtonElement>) => void,
  ) => {
    const handler = handlers[id]
    if (!handler) return null
    return (
      <Button
        key={id}
        type="button"
        variant={inventoryActionVariant(id)}
        size="sm"
        disabled={disabledFor(id)}
        onClick={onClick}
      >
        {inventoryActionLabel(id, { labelMode, inlineSaving, isUploadingPhotos })}
      </Button>
    )
  }

  const renderSlotButtons = (
    slots: readonly InventoryActionSlotId[],
    fromMore: boolean,
  ) =>
    slots.flatMap((slot) => {
      const ids = expandInventoryActionSlot(slot, visibilityState)
      return ids.map((id) => {
        const handler = handlers[id]
        if (!handler) return null
        return renderActionButton(id, fromMore ? runFromMore(handler) : run(handler))
      })
    })

  return (
    <div
      className={["action-row", "inventory-item-actions", className].filter(Boolean).join(" ")}
      onClick={stopCardActivation ? stopActivation : undefined}
      onKeyDown={stopCardActivation ? stopActivation : undefined}
    >
      {renderSlotButtons(actionOrder, false)}

      {showMoreActions && (
        <div
          ref={moreRootRef}
          className={[
            "inventory-more-actions",
            moreOpen ? "inventory-more-actions-open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={moreOpen}
            aria-controls={morePanelId}
            onClick={(e) => {
              if (stopCardActivation) stopActivation(e)
              setMoreOpen((open) => !open)
            }}
          >
            More Actions
          </Button>
          {moreOpen && (
            <div
              id={morePanelId}
              className="inventory-more-actions-panel"
              role="group"
              aria-label="More actions"
            >
              {renderSlotButtons(visibleMoreSlots, true)}
            </div>
          )}
        </div>
      )}

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
