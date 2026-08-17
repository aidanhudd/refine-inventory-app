import { InputHTMLAttributes } from "react"

type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  toolbar?: boolean
}

export default function SearchField({
  className = "",
  toolbar = true,
  ...rest
}: SearchFieldProps) {
  const classes = ["search", toolbar ? "ui-search" : "", className].filter(Boolean).join(" ")
  return <input type="search" className={classes} autoComplete="off" {...rest} />
}
