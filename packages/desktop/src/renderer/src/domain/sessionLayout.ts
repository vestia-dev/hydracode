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
  return count <= 1 ? roundWidth : (roundWidth - horizontalGap * (count - 1)) / count
}

export function splitRoundToolsX(
  roundPosition: GraphPosition,
  roundWidth: number,
  toolsWidth: number,
) {
  return roundPosition.x + roundWidth * 0.25 - toolsWidth / 2
}

export function splitRoundSideNodeX(
  roundPosition: GraphPosition,
  roundWidth: number,
  nodeWidth: number,
  side: "left" | "right",
) {
  return roundPosition.x + roundWidth * (side === "left" ? 0.25 : 0.75) - nodeWidth / 2
}

export function collapsedSubagentPosition(
  roundPosition: GraphPosition,
  roundWidth: number,
  toolsPosition: GraphPosition,
  toolsSize: GraphSize,
  nodeSize: GraphSize,
): GraphPosition {
  return {
    x: roundPosition.x + roundWidth * 0.75 - nodeSize.width / 2,
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
