export interface GraphPosition {
  readonly x: number
  readonly y: number
}

export interface GraphSize {
  readonly width: number
  readonly height: number
}

const TIMELINE_Y = 480

export interface NodeDistance {
  readonly horizontal: number
  readonly vertical: number
}

export function timelinePositions(
  widths: ReadonlyArray<number>,
  distance: NodeDistance,
  origin: GraphPosition = { x: 0, y: TIMELINE_Y },
): ReadonlyArray<GraphPosition> {
  let x = origin.x
  return widths.map((width) => {
    const position = { x, y: origin.y }
    x += width + distance.horizontal
    return position
  })
}

export function spokeOffset(index: number, count: number) {
  return `${((index + 1) / (count + 1)) * 100}%`
}

function branchWidth(sizes: ReadonlyArray<GraphSize>, horizontalDistance: number) {
  return sizes.reduce(
    (width, size, index) => width + size.width + (index === 0 ? 0 : horizontalDistance),
    0,
  )
}

function branchXPositions(
  anchor: GraphPosition,
  agentWidth: number,
  sizes: ReadonlyArray<GraphSize>,
  horizontalDistance: number,
) {
  let x = anchor.x + agentWidth / 2 - branchWidth(sizes, horizontalDistance) / 2
  return sizes.map((size) => {
    const current = x
    x += size.width + horizontalDistance
    return current
  })
}

export function readBranchPositions(
  anchor: GraphPosition,
  agentWidth: number,
  sizes: ReadonlyArray<GraphSize>,
  distance: NodeDistance,
): ReadonlyArray<GraphPosition> {
  const y = anchor.y - Math.max(0, ...sizes.map((size) => size.height)) - distance.vertical
  return branchXPositions(anchor, agentWidth, sizes, distance.horizontal).map((x) => ({ x, y }))
}

export function writeBranchPositions(
  anchor: GraphPosition,
  agentWidth: number,
  agentHeight: number,
  sizes: ReadonlyArray<GraphSize>,
  distance: NodeDistance,
): ReadonlyArray<GraphPosition> {
  const y = anchor.y + agentHeight + distance.vertical
  return branchXPositions(anchor, agentWidth, sizes, distance.horizontal).map((x) => ({ x, y }))
}

export function subagentTimelinePosition(
  anchor: GraphPosition,
  parentWidth: number,
  childWidth: number,
  childHeight: number,
  precedingChildHeights: ReadonlyArray<number>,
  distance: NodeDistance,
): GraphPosition {
  const laneGap = Math.max(48, distance.vertical * 2)
  const precedingLaneHeight = precedingChildHeights.reduce(
    (height, precedingChildHeight) => height + precedingChildHeight + laneGap,
    0,
  )
  return {
    x: anchor.x + (parentWidth - childWidth) / 2,
    y: anchor.y - childHeight - laneGap - precedingLaneHeight,
  }
}
