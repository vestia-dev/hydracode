import type { ComponentPropsWithRef, ReactNode } from "react"

export interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  readonly label: string
  readonly variant: "filled" | "ghost"
  readonly children: ReactNode
}

export function IconButton({
  label,
  variant,
  className,
  children,
  ref,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      className={`icon-button icon-button--${variant}${className === undefined ? "" : ` ${className}`}`}
      aria-label={label}
    >
      {children}
    </button>
  )
}
