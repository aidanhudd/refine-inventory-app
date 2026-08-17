import { HTMLAttributes, ReactNode } from "react"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  tone?: "default" | "alert"
}

export default function Badge({ children, tone = "default", className = "", ...rest }: BadgeProps) {
  const classes = ["badge", tone === "alert" ? "badge-alert" : "", className].filter(Boolean).join(" ")
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  )
}
