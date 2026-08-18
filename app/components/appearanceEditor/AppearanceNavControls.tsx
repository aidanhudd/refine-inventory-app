"use client"

import {
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
  const showEstimate = draft.nav.order.includes("estimate")
  const enabledOrder = draft.nav.order.filter(
    (id): id is NavItemId => id in NAV_LINK_REGISTRY,
  )
  const items = enabledOrder.map((id) => ({
    id,
    label: NAV_LINK_REGISTRY[id].label,
  }))

  const setShowEstimate = (checked: boolean) => {
    if (checked) {
      if (draft.nav.order.includes("estimate")) return
      onReorder([...draft.nav.order.filter((id) => id !== "estimate"), "estimate"])
      return
    }
    onReorder(draft.nav.order.filter((id) => id !== "estimate"))
  }

  return (
    <fieldset className="appearance-editor-fieldset" disabled={disabled}>
      <legend>Navigation order</legend>
      <p className="small">
        Reorder the navigation links that are currently shown. Inventory and Jobs stay required.
        Labels and destinations stay fixed.
      </p>
      <label className="appearance-nav-estimate-toggle">
        <input
          type="checkbox"
          checked={showEstimate}
          disabled={disabled}
          aria-label="Show Estimate in navigation"
          onChange={(e) => setShowEstimate(e.target.checked)}
        />
        Show Estimate in navigation
      </label>
      <p className="small">
        Hiding Estimate removes only its navigation button. The{" "}
        <code>/estimate</code> URL and estimate data remain unchanged.
      </p>
      <AppearanceOrderList
        listLabel="Use Move up and Move down to change primary navigation order."
        items={items}
        order={enabledOrder}
        disabled={disabled}
        onReorder={(next) => onReorder(next as NavItemId[])}
      />
    </fieldset>
  )
}
