import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react"
import { spokePath } from "../projectors/spokePath"

interface SessionSpokeEdgeData extends Record<string, unknown> {
  readonly toggleBranch?: () => void
}

export type SessionSpokeFlowEdge = Edge<SessionSpokeEdgeData, "sessionSpoke">

export function SessionSpokeEdge({
  data,
  id,
  markerEnd,
  markerStart,
  sourceX,
  sourceY,
  sourcePosition,
  style,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<SessionSpokeFlowEdge>) {
  const path = spokePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  return (
    <g
      className={data?.toggleBranch === undefined ? undefined : "branch-edge-toggle"}
      onClick={data?.toggleBranch}
    >
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(markerStart === undefined ? {} : { markerStart })}
        {...(style === undefined ? {} : { style })}
      />
    </g>
  )
}
