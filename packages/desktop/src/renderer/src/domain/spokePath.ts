interface SpokePathInput {
  readonly sourceX: number
  readonly sourceY: number
  readonly sourcePosition: "top" | "right" | "bottom" | "left"
  readonly targetX: number
  readonly targetY: number
  readonly targetPosition: "top" | "right" | "bottom" | "left"
}

export function spokePath({ sourceX, sourceY, targetX, targetY }: SpokePathInput) {
  return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
}
