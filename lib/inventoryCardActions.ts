export const INVENTORY_CARD_ACTION_IDS = [
  "edit",
  "save",
  "cancel",
  "use",
  "hold",
  "releaseHold",
  "addPhotos",
  "markSold",
  "undoMarkSold",
  "delete",
] as const

export type InventoryCardActionId = (typeof INVENTORY_CARD_ACTION_IDS)[number]

/** Default presentation order for list and category cards. Invisible actions are skipped. */
export const DEFAULT_INVENTORY_CARD_ACTION_ORDER: InventoryCardActionId[] = [
  "edit",
  "save",
  "cancel",
  "use",
  "hold",
  "releaseHold",
  "addPhotos",
  "markSold",
  "undoMarkSold",
  "delete",
]

export type InventoryActionLabelMode = "full" | "compact"

export function inventoryActionLabel(
  id: InventoryCardActionId,
  options?: {
    labelMode?: InventoryActionLabelMode
    inlineSaving?: boolean
    isUploadingPhotos?: boolean
    undoingUsage?: boolean
  },
): string {
  const mode = options?.labelMode ?? "full"
  switch (id) {
    case "edit":
      return "Edit"
    case "save":
      return options?.inlineSaving ? "Saving..." : "Save"
    case "cancel":
      return "Cancel"
    case "use":
      return "Use"
    case "hold":
      return "Hold"
    case "releaseHold":
      return mode === "compact" ? "Release" : "Release Hold"
    case "addPhotos":
      if (options?.isUploadingPhotos) return mode === "compact" ? "Uploading…" : "Uploading..."
      return mode === "compact" ? "Photo" : "Add Photos"
    case "markSold":
      return mode === "compact" ? "Sold" : "Mark Sold"
    case "undoMarkSold":
      return "Undo Mark Sold"
    case "delete":
      return "Delete"
    default:
      return id
  }
}

export type InventoryActionVariant = "primary" | "secondary" | "danger" | "edit"

export function inventoryActionVariant(id: InventoryCardActionId): InventoryActionVariant {
  switch (id) {
    case "save":
      return "primary"
    case "edit":
      return "edit"
    case "delete":
      return "danger"
    default:
      return "secondary"
  }
}

export function isInventoryActionVisible(
  id: InventoryCardActionId,
  state: {
    isInlineEditing: boolean
    itemOnHold: boolean
    showSoldUndo: boolean
  },
): boolean {
  switch (id) {
    case "edit":
      return !state.isInlineEditing
    case "save":
    case "cancel":
      return state.isInlineEditing
    case "hold":
      return !state.itemOnHold
    case "releaseHold":
      return state.itemOnHold
    case "undoMarkSold":
      return state.isInlineEditing && state.showSoldUndo
    case "use":
    case "addPhotos":
    case "markSold":
    case "delete":
      return true
    default:
      return false
  }
}
