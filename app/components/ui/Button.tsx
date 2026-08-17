import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react"

type ButtonVariant = "primary" | "secondary" | "danger" | "edit" | "ghost"
type ButtonSize = "md" | "sm"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  edit: "btn-edit",
  ghost: "btn-ghost",
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    className = "",
    type = "button",
    children,
    ...rest
  },
  ref,
) {
  const classes = [variantClass[variant], size === "sm" ? "btn-small" : "", className]
    .filter(Boolean)
    .join(" ")

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {children}
    </button>
  )
})

export default Button
