export interface GraphPosition {
  readonly x: number
  readonly y: number
}

export interface GraphSize {
  readonly width: number
  readonly height: number
}

const TIMELINE_Y = 480
const MIN_BRANCH_WIDTH = 290

export interface NodeDistance {
  readonly horizontal: number
  readonly vertical: number
}

export function roundTimelineDistance(distance: NodeDistance): NodeDistance {
  return { ...distance, horizontal: Math.round(distance.horizontal * 1.5) }
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

export function roundSideNodePosition(
  roundPosition: GraphPosition,
  roundSize: GraphSize,
  nodeHeight: number,
  verticalGap: number,
  side: "top" | "bottom",
): GraphPosition {
  return {
    x: roundPosition.x,
    y:
      side === "top"
        ? roundPosition.y - nodeHeight - verticalGap
        : roundPosition.y + roundSize.height + verticalGap,
  }
}

export function horizontalRoundSideNodePosition(
  roundPosition: GraphPosition,
  roundSize: GraphSize,
  nodeSize: GraphSize,
  horizontalGap: number,
  side: "left" | "right",
): GraphPosition {
  return {
    x:
      side === "left"
        ? roundPosition.x - nodeSize.width - horizontalGap
        : roundPosition.x + roundSize.width + horizontalGap,
    y: roundPosition.y,
  }
}

export function splitRoundToolsWidth(roundWidth: number, horizontalGap: number) {
  return roundBranchWidth(roundWidth, horizontalGap, 2)
}

export function roundBranchWidth(roundWidth: number, horizontalGap: number, count: number) {
  return count <= 1
    ? roundWidth
    : Math.max(MIN_BRANCH_WIDTH, (roundWidth - horizontalGap * (count - 1)) / count)
}

export function roundBranchOverhang(roundWidth: number, horizontalGap: number) {
  const branchWidth = roundBranchWidth(roundWidth, horizontalGap, 2)
  return Math.max(0, (branchWidth * 2 + horizontalGap - roundWidth) / 2)
}

export function splitRoundToolsX(
  roundPosition: GraphPosition,
  roundWidth: number,
  toolsWidth: number,
  horizontalGap: number,
) {
  return roundPosition.x + roundWidth / 2 - horizontalGap / 2 - toolsWidth
}

export function splitRoundSideNodeX(
  roundPosition: GraphPosition,
  roundWidth: number,
  nodeWidth: number,
  side: "left" | "right",
  horizontalGap: number,
) {
  const center = roundPosition.x + roundWidth / 2
  return side === "left" ? center - horizontalGap / 2 - nodeWidth : center + horizontalGap / 2
}

export function collapsedSubagentPosition(
  roundPosition: GraphPosition,
  roundWidth: number,
  toolsPosition: GraphPosition,
  toolsSize: GraphSize,
  nodeSize: GraphSize,
  horizontalGap: number,
): GraphPosition {
  return {
    x: roundPosition.x + roundWidth / 2 + horizontalGap / 2,
    y: toolsPosition.y + toolsSize.height - nodeSize.height,
  }
}

export function subagentTimelinePosition(
  roundPosition: GraphPosition,
  roundSize: GraphSize,
  toolsPosition: GraphPosition,
  childSize: GraphSize,
  precedingChildHeights: ReadonlyArray<number>,
  distance: NodeDistance,
): GraphPosition {
  const precedingLaneHeight = precedingChildHeights.reduce(
    (height, precedingChildHeight) => height + precedingChildHeight + distance.vertical,
    0,
  )
  return {
    x: roundPosition.x + roundSize.width * 0.75 - childSize.width / 2,
    y: toolsPosition.y - childSize.height - distance.vertical - precedingLaneHeight,
  }
}
