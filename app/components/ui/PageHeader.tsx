import { ReactNode } from "react"

type PageHeaderProps = {
  title: string
  description?: ReactNode
  className?: string
}

export default function PageHeader({ title, description, className = "" }: PageHeaderProps) {
  return (
    <header className={["page-header", className].filter(Boolean).join(" ")}>
      <h1 className="page-header-title">{title}</h1>
      {description != null && description !== "" && (
        <p className="page-header-description">{description}</p>
      )}
    </header>
  )
}
