"use client"

import { ReactNode, useEffect } from "react"
import { ModalShell } from "./ui"

type CategoryItemDetailModalProps = {
  open: boolean
  /** True when Use, Hold, or photo lightbox is above this modal. */
  nestedLayerActive: boolean
  inlineSaving: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Category inventory item detail modal (detailPresentation === "modal").
 * Reuses CategoryExpandedItemPanel content via children; becomes inactive/inert
 * when nested Use/Hold/lightbox layers own Escape and focus.
 * Card focus restore is owned by the page after close.
 */
export default function CategoryItemDetailModal({
  open,
  nestedLayerActive,
  inlineSaving,
  onClose,
  children,
}: CategoryItemDetailModalProps) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  const canDismiss = !nestedLayerActive && !inlineSaving

  return (
    <div className="category-item-detail-modal-root">
      <ModalShell
        ariaLabel="Inventory item details"
        panelClassName="modal-panel modal-panel-inventory-detail"
        className={nestedLayerActive ? "modal-shell-under-nested" : ""}
        inactive={nestedLayerActive}
        dismissDisabled={!canDismiss}
        onEscape={canDismiss ? onClose : undefined}
        onOverlayClick={canDismiss ? onClose : undefined}
        restoreFocus={false}
        lockBodyScroll={false}
      >
        {children}
      </ModalShell>
    </div>
  )
}
