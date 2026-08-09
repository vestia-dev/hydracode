interface LoadingIndicatorProps {
  readonly label: string
  readonly compact?: boolean
}

export function LoadingIndicator({ label, compact = false }: LoadingIndicatorProps) {
  return (
    <span
      className={`loading-indicator${compact ? " loading-indicator--compact" : ""}`}
      role="status"
    >
      <span className="loading-indicator__spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
