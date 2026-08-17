import { HTMLAttributes, ReactNode } from "react"

type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  /** Sticky inventory-style toolbar (search + toggles + primary CTA). */
  sticky?: boolean
}

export default function Toolbar({ children, sticky = false, className = "", ...rest }: ToolbarProps) {
  const classes = [
    "ui-toolbar",
    sticky ? "toolbar" : "jobs-toolbar",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
