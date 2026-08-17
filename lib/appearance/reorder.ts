/**
 * Pure list reorder helpers for Appearance order editors.
 * Never inserts, removes, or invents IDs — only swaps adjacent positions.
 */

export type ReorderDirection = "up" | "down"

/** Swap an item with its neighbor. Returns a new array; invalid moves return a shallow copy. */
export function moveItemInOrder<T>(
  order: readonly T[],
  index: number,
  direction: ReorderDirection,
): T[] {
  const next = order.slice()
  const targetIndex = direction === "up" ? index - 1 : index + 1
  if (index < 0 || index >= next.length) return next
  if (targetIndex < 0 || targetIndex >= next.length) return next

  const current = next[index] as T
  next[index] = next[targetIndex] as T
  next[targetIndex] = current
  return next
}

/** Move the first matching id up or down by one position. */
export function moveOrderItemById<T extends string>(
  order: readonly T[],
  id: T,
  direction: ReorderDirection,
): T[] {
  const index = order.indexOf(id)
  if (index < 0) return order.slice()
  return moveItemInOrder(order, index, direction)
}

export function canMoveOrderItem(
  orderLength: number,
  index: number,
  direction: ReorderDirection,
): boolean {
  if (index < 0 || index >= orderLength) return false
  if (direction === "up") return index > 0
  return index < orderLength - 1
}

export type ActionPartitionDestination = "primary" | "more"

/**
 * Move one action slot between primary (`actionOrder`) and More Actions.
 * Removes the id from both lists, then appends once to the destination.
 */
export function moveActionBetweenPartitions<T extends string>(
  actionOrder: readonly T[],
  moreActions: readonly T[],
  id: T,
  destination: ActionPartitionDestination,
): { actionOrder: T[]; moreActions: T[] } {
  const withoutId = (list: readonly T[]) => list.filter((entry) => entry !== id)
  const nextPrimary = withoutId(actionOrder)
  const nextMore = withoutId(moreActions)

  if (destination === "primary") {
    return { actionOrder: [...nextPrimary, id], moreActions: nextMore }
  }
  return { actionOrder: nextPrimary, moreActions: [...nextMore, id] }
}

/** Add or remove an optional field id from hiddenFields (once, no duplicates). */
export function setOptionalFieldHidden<T extends string>(
  hiddenFields: readonly T[],
  id: T,
  hidden: boolean,
): T[] {
  if (hidden) {
    if (hiddenFields.includes(id)) return hiddenFields.slice()
    return [...hiddenFields, id]
  }
  return hiddenFields.filter((entry) => entry !== id)
}
