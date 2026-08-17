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
}

export default function ViewToggle({ options, ariaLabel, className = "" }: ViewToggleProps) {
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
          onClick={option.onSelect}
          aria-pressed={option.active}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
