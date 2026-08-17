"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  INVENTORY_ACTION_SLOT_IDS,
  INVENTORY_ACTION_SLOT_LABELS,
  moveActionBetweenPartitions,
  type AppearanceConfig,
  type InventoryActionSlotId,
} from "../../../lib/appearance"
import { Button } from "../ui"
import AppearanceOrderList from "./AppearanceOrderList"

type AppearanceInventoryActionsControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onChangeActionPartitions: (next: {
    actionOrder: InventoryActionSlotId[]
    moreActions: InventoryActionSlotId[]
  }) => void
}

export default function AppearanceInventoryActionsControls({
  draft,
  disabled = false,
  onChangeActionPartitions,
}: AppearanceInventoryActionsControlsProps) {
  const items = INVENTORY_ACTION_SLOT_IDS.map((id) => ({
    id,
    label: INVENTORY_ACTION_SLOT_LABELS[id],
  }))
  const liveId = useId()
  const [announcement, setAnnouncement] = useState("")
  const transferRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pendingTransferFocusRef = useRef<InventoryActionSlotId | null>(null)

  const { actionOrder, moreActions } = draft.inventory.card

  useEffect(() => {
    const id = pendingTransferFocusRef.current
    if (!id) return
    pendingTransferFocusRef.current = null
    const button = transferRefs.current.get(id)
    if (button && !button.disabled) {
      button.focus()
    }
  }, [actionOrder, moreActions])

  const moveTo = (id: InventoryActionSlotId, destination: "primary" | "more") => {
    if (disabled) return
    const next = moveActionBetweenPartitions(actionOrder, moreActions, id, destination)
    const destList = destination === "primary" ? next.actionOrder : next.moreActions
    const position = destList.indexOf(id) + 1
    const label = INVENTORY_ACTION_SLOT_LABELS[id]
    const destName = destination === "primary" ? "Primary actions" : "More Actions"
    pendingTransferFocusRef.current = id
    onChangeActionPartitions(next)
    setAnnouncement(
      `Moved ${label} to ${destName}, position ${position} of ${destList.length}.`,
    )
  }

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Inventory card actions</legend>
      <p className="small">
        Place each action in Primary or More Actions. Every action appears exactly once. Actions
        cannot be deleted or hidden. Save and Cancel follow Edit while editing; Release Hold
        follows Hold by item state — those are not separate configurable entries.
      </p>

      <div className="appearance-editor-field">
        <h3 className="appearance-editor-subsection-title">Primary actions</h3>
        <AppearanceOrderList
          listLabel="Reorder primary inventory card actions."
          emptyMessage="No primary actions. Move an action here from More Actions."
          items={items}
          order={actionOrder}
          disabled={disabled}
          onReorder={(next) =>
            onChangeActionPartitions({
              actionOrder: next as InventoryActionSlotId[],
              moreActions: [...moreActions],
            })
          }
          renderAccessory={({ id, label }) => (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              aria-label={`Move ${label} to More Actions`}
              ref={(node) => {
                if (node) transferRefs.current.set(id, node)
                else transferRefs.current.delete(id)
              }}
              onClick={() => moveTo(id, "more")}
            >
              Move to More Actions
            </Button>
          )}
        />
      </div>

      <div className="appearance-editor-field">
        <h3 className="appearance-editor-subsection-title">More Actions</h3>
        <AppearanceOrderList
          listLabel="Reorder More Actions overflow slots."
          emptyMessage="No More Actions. Move an action here from Primary actions."
          items={items}
          order={moreActions}
          disabled={disabled}
          onReorder={(next) =>
            onChangeActionPartitions({
              actionOrder: [...actionOrder],
              moreActions: next as InventoryActionSlotId[],
            })
          }
          renderAccessory={({ id, label }) => (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              aria-label={`Move ${label} to Primary actions`}
              ref={(node) => {
                if (node) transferRefs.current.set(id, node)
                else transferRefs.current.delete(id)
              }}
              onClick={() => moveTo(id, "primary")}
            >
              Move to Primary
            </Button>
          )}
        />
      </div>

      <div id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </fieldset>
  )
}
