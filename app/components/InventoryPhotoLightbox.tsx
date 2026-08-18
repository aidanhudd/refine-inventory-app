"use client"

import { Button, ModalShell } from "./ui"

type InventoryPhotoLightboxProps = {
  src: string
  onClose: () => void
}

/**
 * Accessible full-size inventory photo preview.
 * Uses ModalShell for Escape, overlay dismiss, focus trap, and return focus.
 */
export default function InventoryPhotoLightbox({ src, onClose }: InventoryPhotoLightboxProps) {
  return (
    <ModalShell
      ariaLabel="Inventory photo preview"
      className="photo-lightbox-overlay"
      panelClassName="photo-lightbox-panel"
      onEscape={onClose}
      onOverlayClick={onClose}
    >
      <div className="photo-lightbox-toolbar">
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <img src={src} alt="Full size inventory photo" className="photo-lightbox-image" />
    </ModalShell>
  )
}
