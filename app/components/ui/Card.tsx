import { HTMLAttributes, ReactNode } from "react"

type CardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode
  as?: "section" | "div" | "article"
}

export default function Card({
  children,
  as: Tag = "section",
  className = "",
  ...rest
}: CardProps) {
  return (
    <Tag className={["card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Tag>
  )
}
