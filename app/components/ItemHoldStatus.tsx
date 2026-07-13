"use client"

import { isItemOnHold } from "../../lib/itemHold"

type ItemHoldStatusProps = {
  holdLastName: string | null | undefined
  compact?: boolean
}

export default function ItemHoldStatus({ holdLastName, compact = false }: ItemHoldStatusProps) {
  const onHold = isItemOnHold(holdLastName)
  const label = onHold ? holdLastName!.trim() : compact ? "Available" : "Available to show"

  return (
    <div
      className={`item-hold-status ${compact ? "item-hold-status-compact" : ""}`}
      title={onHold ? `On hold for ${label}` : "Available to show customers"}
    >
      <span
        className={`item-hold-dot ${onHold ? "item-hold-dot-on" : "item-hold-dot-available"}`}
        aria-hidden="true"
      />
      <span className="item-hold-label">{label}</span>
    </div>
  )
}
