import {
  isInventoryActionVisible,
  type InventoryCardActionId,
} from "../inventoryCardActions"
import type { InventoryActionSlotId } from "./types"

export type InventoryActionVisibilityState = {
  isInlineEditing: boolean
  itemOnHold: boolean
  showSoldUndo: boolean
}

/**
 * Expand one configurable action slot into the rendered button ID(s) that are
 * currently visible. Save/Cancel stay together under edit; Hold/Release under hold.
 */
export function expandInventoryActionSlot(
  slot: InventoryActionSlotId,
  state: InventoryActionVisibilityState,
): InventoryCardActionId[] {
  switch (slot) {
    case "edit":
      return (["edit", "save", "cancel"] as const).filter((id) =>
        isInventoryActionVisible(id, state),
      )
    case "hold":
      return (["hold", "releaseHold"] as const).filter((id) =>
        isInventoryActionVisible(id, state),
      )
    case "use":
    case "addPhotos":
    case "markSold":
    case "undoMarkSold":
    case "delete":
      return isInventoryActionVisible(slot, state) ? [slot] : []
    default:
      return []
  }
}

/** Flatten ordered slots to currently visible rendered action IDs. */
export function expandInventoryActionSlots(
  slots: readonly InventoryActionSlotId[],
  state: InventoryActionVisibilityState,
): InventoryCardActionId[] {
  const out: InventoryCardActionId[] = []
  for (const slot of slots) {
    out.push(...expandInventoryActionSlot(slot, state))
  }
  return out
}

export function inventoryActionSlotHasVisibleActions(
  slot: InventoryActionSlotId,
  state: InventoryActionVisibilityState,
): boolean {
  return expandInventoryActionSlot(slot, state).length > 0
}
