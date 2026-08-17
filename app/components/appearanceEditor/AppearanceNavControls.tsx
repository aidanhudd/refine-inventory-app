"use client"

import {
  NAV_ITEM_IDS,
  NAV_LINK_REGISTRY,
  type AppearanceConfig,
  type NavItemId,
} from "../../../lib/appearance"
import AppearanceOrderList from "./AppearanceOrderList"

type AppearanceNavControlsProps = {
  draft: AppearanceConfig
  disabled?: boolean
  onReorder: (order: NavItemId[]) => void
}

export default function AppearanceNavControls({
  draft,
  disabled = false,
  onReorder,
}: AppearanceNavControlsProps) {
  const items = NAV_ITEM_IDS.map((id) => ({
    id,
    label: NAV_LINK_REGISTRY[id].label,
  }))

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Navigation order</legend>
      <p className="small">
        Reorder Inventory, Jobs, and Estimate. Labels and destinations stay fixed. All three remain
        visible.
      </p>
      <AppearanceOrderList
        listLabel="Use Move up and Move down to change primary navigation order."
        items={items}
        order={draft.nav.order}
        disabled={disabled}
        onReorder={(next) => onReorder(next as NavItemId[])}
      />
    </fieldset>
  )
}
