const CORRIDOR_OFFSET = 16
const BEND_RADIUS = 8

interface SpokePathInput {
  readonly sourceX: number
  readonly sourceY: number
  readonly targetX: number
  readonly targetY: number
}

export function spokePath({ sourceX, sourceY, targetX, targetY }: SpokePathInput) {
  if (sourceX === targetX) return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`

  const verticalDirection = targetY < sourceY ? -1 : 1
  const horizontalDirection = targetX < sourceX ? -1 : 1
  const corridorY = sourceY + verticalDirection * CORRIDOR_OFFSET
  const radius = Math.min(
    BEND_RADIUS,
    Math.abs(targetX - sourceX) / 2,
    Math.abs(targetY - corridorY) / 2,
  )

  return [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX} ${corridorY - verticalDirection * radius}`,
    `Q ${sourceX} ${corridorY} ${sourceX + horizontalDirection * radius} ${corridorY}`,
    `L ${targetX - horizontalDirection * radius} ${corridorY}`,
    `Q ${targetX} ${corridorY} ${targetX} ${corridorY + verticalDirection * radius}`,
    `L ${targetX} ${targetY}`,
  ].join(" ")
}
