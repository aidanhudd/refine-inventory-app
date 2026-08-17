import { ReactNode } from "react"

type EmptyStateProps = {
  children: ReactNode
  className?: string
}

export default function EmptyState({ children, className = "" }: EmptyStateProps) {
  return <div className={["empty", className].filter(Boolean).join(" ")}>{children}</div>
}
