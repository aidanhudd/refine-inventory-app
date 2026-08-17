import type {
  InventoryActionSlotId,
  InventoryCardFieldId,
} from "./types"

/** Fixed editor/preview labels — never stored in appearance config. */
export const INVENTORY_CARD_FIELD_LABELS: Record<InventoryCardFieldId, string> = {
  holdStatus: "Hold status",
  productName: "Product name",
  quantity: "Quantity",
  badges: "Category badges",
  unitCost: "Unit cost",
  location: "Location",
  dimensions: "Dimensions",
  totalValue: "Total value",
  status: "Status",
  createdAt: "Created date",
  notes: "Notes",
  usageHistory: "Usage history",
  photos: "Photos",
}

/** Fixed editor/preview labels for configurable action slots. */
export const INVENTORY_ACTION_SLOT_LABELS: Record<InventoryActionSlotId, string> = {
  edit: "Edit",
  use: "Use",
  hold: "Hold / Release Hold",
  addPhotos: "Add Photos",
  markSold: "Mark Sold",
  undoMarkSold: "Undo Mark Sold",
  delete: "Delete",
}
