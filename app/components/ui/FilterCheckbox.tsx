import { InputHTMLAttributes } from "react"

type FilterCheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string
}

export default function FilterCheckbox({ label, className = "", id, ...rest }: FilterCheckboxProps) {
  const inputId = id || undefined
  return (
    <label className={["ui-filter-checkbox", "jobs-include-completed", className].filter(Boolean).join(" ")} htmlFor={inputId}>
      <input id={inputId} type="checkbox" {...rest} />
      {label}
    </label>
  )
}
