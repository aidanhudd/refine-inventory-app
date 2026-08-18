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

function listFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  )
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
      if (panel.contains(document.activeElement)) return
      const preferred = initialFocusRef?.current
      if (preferred && panel.contains(preferred)) {
        preferred.focus()
        return
      }
      const items = listFocusable(panel)
      items[0]?.focus()
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

      const items = listFocusable(panel)
      if (items.length === 0) {
        event.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || !panel.contains(active)) {
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
      if (target && document.contains(target)) {
        target.focus()
      }
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
      >
        {children}
      </div>
    </div>
  )
}
