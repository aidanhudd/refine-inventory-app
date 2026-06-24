"use client"

import { useHidePrices } from "./HidePricesProvider"

export default function HidePricesSwitch() {
  const { hidePrices, canToggleHidePrices, setHidePrices } = useHidePrices()

  if (!canToggleHidePrices) return null

  return (
    <label className="hide-prices-switch" title={hidePrices ? "Prices are hidden" : "Prices are visible"}>
      <span className="hide-prices-switch-label">Hide prices</span>
      <span className="hide-prices-switch-control">
        <input
          type="checkbox"
          className="hide-prices-switch-input"
          checked={hidePrices}
          onChange={(e) => setHidePrices(e.target.checked)}
          aria-label="Hide prices"
        />
        <span className="hide-prices-switch-track" aria-hidden="true">
          <span className="hide-prices-switch-thumb" />
        </span>
      </span>
    </label>
  )
}
