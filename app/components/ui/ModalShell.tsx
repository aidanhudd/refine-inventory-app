"use client"

import {
  MouseEvent,
  ReactNode,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export type ModalShellProps = {
  children: ReactNode
  ariaLabel: string
  /** Overlay click when dismissal is allowed. */
  onOverlayClick?: () => void
  /**
   * Escape when dismissal is allowed. Prefer the same close path as overlay/Cancel.
   * When omitted, Escape does nothing (caller may use dismissDisabled alone).
   */
  onEscape?: () => void
  /** When true, Escape and overlay do not dismiss. */
  dismissDisabled?: boolean
  /**
   * When true, this dialog is under a nested layer: inert, no Escape/Tab ownership.
   * The topmost modal must remain active.
   */
  inactive?: boolean
  panelClassName?: string
  className?: string
  /** Restore focus to the opener on unmount. Defaults to true. */
  restoreFocus?: boolean
  /** Lock document body scroll while this modal is the active layer. Defaults to true. */
  lockBodyScroll?: boolean
  /** Optional explicit initial focus target; otherwise first focusable in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

function isDisabledControl(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return true
  if (el.getAttribute("aria-disabled") === "true") return true
  if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    return el.disabled
  }
  return false
}

function hasHiddenAncestor(el: HTMLElement, root: HTMLElement): boolean {
  let node: HTMLElement | null = el
  while (node && node !== root) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true
    if (node.hasAttribute("inert")) return true
    node = node.parentElement
  }
  // Also reject if root itself is inert/hidden (inactive dialog).
  if (root.hidden || root.getAttribute("aria-hidden") === "true" || root.hasAttribute("inert")) {
    return true
  }
  return false
}

function isVisuallyFocusable(el: HTMLElement, root: HTMLElement): boolean {
  if (isDisabledControl(el)) return false
  if (el.tabIndex < 0 && el !== root) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (hasHiddenAncestor(el, root)) return false
  if (el.getClientRects().length === 0) return false

  const style = window.getComputedStyle(el)
  if (style.visibility === "hidden" || style.display === "none") return false

  return true
}

/** Visible, interactive focus targets inside a dialog panel (excludes display:none / aria-hidden trees). */
export function listFocusableInModal(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) =>
    isVisuallyFocusable(el, panel),
  )
}

function canRestoreFocusTo(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (isDisabledControl(el)) return false
  if (el.getClientRects().length === 0) return false

  const style = window.getComputedStyle(el)
  if (style.visibility === "hidden" || style.display === "none") return false

  let node: HTMLElement | null = el
  while (node) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false
    if (node.hasAttribute("inert")) return false
    node = node.parentElement
  }

  return true
}

/**
 * Shared modal chrome: dialog semantics, Escape, focus trap, initial focus, return focus.
 * Only one active (non-inactive) ModalShell should own keyboard focus at a time.
 */
export default function ModalShell({
  children,
  ariaLabel,
  onOverlayClick,
  onEscape,
  dismissDisabled = false,
  inactive = false,
  panelClassName = "modal-panel modal-panel-job-flow",
  className = "",
  restoreFocus = true,
  lockBodyScroll = true,
  initialFocusRef,
}: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onEscapeRef = useRef(onEscape)
  const dismissDisabledRef = useRef(dismissDisabled)
  const inactiveRef = useRef(inactive)
  onEscapeRef.current = onEscape
  dismissDisabledRef.current = dismissDisabled
  inactiveRef.current = inactive

  useLayoutEffect(() => {
    if (inactive) return
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      returnFocusRef.current = active
    }
  }, [inactive])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    panel.inert = inactive
    if (inactive) {
      return () => {
        panel.inert = false
      }
    }

    const previousOverflow = lockBodyScroll ? document.body.style.overflow : null
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden"
    }

    const focusInitial = () => {
      // Preserve focus already inside this dialog (e.g. nested opener restored into category detail).
      if (panel.contains(document.activeElement)) return

      const preferred = initialFocusRef?.current
      if (preferred && panel.contains(preferred) && isVisuallyFocusable(preferred, panel)) {
        preferred.focus()
        return
      }

      const items = listFocusableInModal(panel)
      if (items[0]) {
        items[0].focus()
        return
      }
      panel.focus()
    }

    const frame = window.requestAnimationFrame(focusInitial)

    const onKeyDown = (event: KeyboardEvent) => {
      if (inactiveRef.current) return

      if (event.key === "Escape") {
        if (dismissDisabledRef.current) return
        const handler = onEscapeRef.current
        if (!handler) return
        event.preventDefault()
        event.stopPropagation()
        handler()
        return
      }

      if (event.key !== "Tab") return

      const items = listFocusableInModal(panel)
      if (items.length === 0) {
        event.preventDefault()
        if (document.activeElement !== panel) {
          panel.focus()
        }
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || active === panel || !panel.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown, true)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKeyDown, true)
      panel.inert = false
      if (lockBodyScroll && previousOverflow !== null) {
        document.body.style.overflow = previousOverflow
      }

      if (!restoreFocus) return
      const target = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (target && canRestoreFocusTo(target)) {
          target.focus()
        }
      })
    }
  }, [inactive, initialFocusRef, restoreFocus, lockBodyScroll])

  const handleOverlayClick = () => {
    if (inactive || dismissDisabled) return
    onOverlayClick?.()
  }

  return (
    <div
      className={["modal-overlay", "modal-shell-overlay", className].filter(Boolean).join(" ")}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
