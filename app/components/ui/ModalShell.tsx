import { MouseEvent, ReactNode } from "react"

type ModalShellProps = {
  children: ReactNode
  ariaLabel: string
  onOverlayClick?: () => void
  panelClassName?: string
  className?: string
}

export default function ModalShell({
  children,
  ariaLabel,
  onOverlayClick,
  panelClassName = "modal-panel modal-panel-job-flow",
  className = "",
}: ModalShellProps) {
  return (
    <div
      className={["modal-overlay", "modal-shell-overlay", className].filter(Boolean).join(" ")}
      onClick={onOverlayClick}
    >
      <div
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
