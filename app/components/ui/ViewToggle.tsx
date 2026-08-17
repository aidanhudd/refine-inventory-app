type ViewToggleOption = {
  id: string
  label: string
  active: boolean
  onSelect: () => void
}

type ViewToggleProps = {
  options: ViewToggleOption[]
  ariaLabel: string
  className?: string
  /**
   * When false, options stay visible for preview/mock UI but are removed from
   * keyboard navigation and do not receive clicks. Defaults to true.
   */
  focusable?: boolean
}

export default function ViewToggle({
  options,
  ariaLabel,
  className = "",
  focusable = true,
}: ViewToggleProps) {
  return (
    <div
      className={["toolbar-view-toggle", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`toolbar-view-btn ${option.active ? "toolbar-view-btn-active" : ""}`}
          onClick={focusable ? option.onSelect : undefined}
          aria-pressed={option.active}
          tabIndex={focusable ? undefined : -1}
          aria-disabled={focusable ? undefined : true}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
