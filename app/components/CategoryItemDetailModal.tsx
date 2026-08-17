"use client"

import {
  ReactNode,
  useEffect,
  useRef,
} from "react"
import { ModalShell } from "./ui"

type CategoryItemDetailModalProps = {
  open: boolean
  /** True when Use, Hold, or photo lightbox is above this modal. */
  nestedLayerActive: boolean
  inlineSaving: boolean
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

/**
 * Category inventory item detail modal (detailPresentation === "modal").
 * Reuses CategoryExpandedItemPanel content via children; coordinates inert state
 * when nested Use/Hold/lightbox layers are active.
 */
export default function CategoryItemDetailModal({
  open,
  nestedLayerActive,
  inlineSaving,
  onClose,
  children,
}: CategoryItemDetailModalProps) {
  const overlayWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const dialog = overlayWrapRef.current?.querySelector<HTMLElement>('[role="dialog"]')
    if (!dialog) return

    dialog.inert = nestedLayerActive

    if (nestedLayerActive) return

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      )

    const initial = focusables()
    const closeButton =
      initial.find((el) => el.textContent?.trim() === "Close") ?? initial[0]
    closeButton?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || nestedLayerActive) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || !dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener("keydown", onKeyDown)
    return () => {
      dialog.removeEventListener("keydown", onKeyDown)
      dialog.inert = false
    }
  }, [open, nestedLayerActive])

  if (!open) return null

  const canDismiss = !nestedLayerActive && !inlineSaving

  return (
    <div ref={overlayWrapRef} className="category-item-detail-modal-root">
      <ModalShell
        ariaLabel="Inventory item details"
        panelClassName="modal-panel modal-panel-inventory-detail"
        className={nestedLayerActive ? "modal-shell-under-nested" : ""}
        onOverlayClick={canDismiss ? onClose : undefined}
      >
        {children}
      </ModalShell>
    </div>
  )
}
