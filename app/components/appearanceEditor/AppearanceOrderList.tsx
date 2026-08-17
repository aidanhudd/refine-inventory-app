"use client"

import { ReactNode, useEffect, useId, useRef, useState } from "react"
import {
  canMoveOrderItem,
  moveOrderItemById,
  type ReorderDirection,
} from "../../../lib/appearance/reorder"
import { Button } from "../ui"

export type AppearanceOrderListItem<T extends string> = {
  id: T
  label: string
}

type AppearanceOrderListProps<T extends string> = {
  items: AppearanceOrderListItem<T>[]
  /** Current order — must be a permutation of (or subset of) item ids. */
  order: readonly T[]
  onReorder: (next: T[]) => void
  disabled?: boolean
  listLabel: string
  emptyMessage?: string
  renderAccessory?: (item: {
    id: T
    label: string
    index: number
  }) => ReactNode
}

/**
 * Accessible Move Up / Move Down order editor (no drag-and-drop).
 * Keeps focus on an enabled move control for the moved item and announces via a live region.
 */
export default function AppearanceOrderList<T extends string>({
  items,
  order,
  onReorder,
  disabled = false,
  listLabel,
  emptyMessage = "No items in this section.",
  renderAccessory,
}: AppearanceOrderListProps<T>) {
  const liveId = useId()
  const [announcement, setAnnouncement] = useState("")
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pendingFocusRef = useRef<{ id: T; direction: ReorderDirection } | null>(null)

  const labelById = new Map(items.map((item) => [item.id, item.label] as const))
  const orderedIds = order.filter((id): id is T => labelById.has(id))

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null

    const preferredKey = `${pending.id}:${pending.direction}`
    const preferred = buttonRefs.current.get(preferredKey)
    if (preferred && !preferred.disabled) {
      preferred.focus()
      return
    }

    const opposite: ReorderDirection = pending.direction === "up" ? "down" : "up"
    const fallback = buttonRefs.current.get(`${pending.id}:${opposite}`)
    if (fallback && !fallback.disabled) {
      fallback.focus()
    }
  }, [order])

  const move = (id: T, direction: ReorderDirection) => {
    if (disabled) return
    const index = orderedIds.indexOf(id)
    if (!canMoveOrderItem(orderedIds.length, index, direction)) return

    const next = moveOrderItemById(orderedIds, id, direction)
    const newIndex = next.indexOf(id)
    const label = labelById.get(id) || id
    pendingFocusRef.current = { id, direction }
    onReorder(next)
    setAnnouncement(`Moved ${label} to position ${newIndex + 1} of ${next.length}.`)
  }

  return (
    <div className="appearance-order-list">
      <p className="small appearance-order-list-hint">{listLabel}</p>
      {orderedIds.length === 0 ? (
        <p className="appearance-order-list-empty">{emptyMessage}</p>
      ) : (
        <ol className="appearance-order-list-items">
          {orderedIds.map((id, index) => {
            const label = labelById.get(id) || id
            const canUp = canMoveOrderItem(orderedIds.length, index, "up")
            const canDown = canMoveOrderItem(orderedIds.length, index, "down")

            return (
              <li key={id} className="appearance-order-list-row">
                <div className="appearance-order-list-meta">
                  <span className="appearance-order-list-position" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="appearance-order-list-label">{label}</span>
                </div>
                <div className="appearance-order-list-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || !canUp}
                    aria-label={`Move ${label} up`}
                    ref={(node) => {
                      const key = `${id}:up`
                      if (node) buttonRefs.current.set(key, node)
                      else buttonRefs.current.delete(key)
                    }}
                    onClick={() => move(id, "up")}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || !canDown}
                    aria-label={`Move ${label} down`}
                    ref={(node) => {
                      const key = `${id}:down`
                      if (node) buttonRefs.current.set(key, node)
                      else buttonRefs.current.delete(key)
                    }}
                    onClick={() => move(id, "down")}
                  >
                    Move down
                  </Button>
                  {renderAccessory?.({ id, label, index })}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <div id={liveId} className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  )
}
