import { ReactNode } from "react"

type NoticeTone = "warning" | "success"

type NoticeProps = {
  children: ReactNode
  tone?: NoticeTone
  className?: string
}

export default function Notice({ children, tone = "warning", className = "" }: NoticeProps) {
  const toneClass = tone === "success" ? "success" : "notice"
  return <div className={[toneClass, className].filter(Boolean).join(" ")}>{children}</div>
}
