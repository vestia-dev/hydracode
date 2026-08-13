import { useEffect, useRef } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphNodeStatus, GraphRoundTools } from "../domain/graph"
import { groupToolCalls } from "../projectors/toolCallGroups"
import { LoadingIndicator } from "./LoadingIndicator"

export interface SessionRoundToolsNodeData extends Record<string, unknown> {
  readonly id: string
  readonly maxHeight?: number
  readonly width: number
  readonly status: GraphNodeStatus
  readonly targetSide: "bottom" | "right"
  readonly tools: GraphRoundTools
  readonly reportSize: (id: string, width: number, height: number) => void
}

export type SessionRoundToolsFlowNode = Node<SessionRoundToolsNodeData, "sessionRoundTools">

export function SessionRoundToolsNode({ data }: NodeProps<SessionRoundToolsFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const groups = groupToolCalls(data.tools.calls)

  useEffect(() => {
    const element = nodeRef.current
    if (element === null) return undefined
    const reportSize = () => {
      data.reportSize(data.id, element.offsetWidth, element.offsetHeight)
      updateNodeInternals(data.id)
    }
    reportSize()
    const observer = new ResizeObserver(reportSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data.id, data.reportSize, data.targetSide, data.width, updateNodeInternals])

  return (
    <article
      ref={nodeRef}
      className={`round-tools-node${data.status === "running" ? " round-tools-node--running" : ""}`}
      style={{
        width: data.width,
        ...(data.maxHeight === undefined ? {} : { maxHeight: data.maxHeight }),
      }}
    >
      <Handle
        id="tools-target"
        type="target"
        position={data.targetSide === "right" ? Position.Right : Position.Bottom}
        style={data.targetSide === "right" ? { top: "50%" } : undefined}
      />
      <header className="round-side-node__heading">
        <strong>Tools</strong>
        <span>{groups.length}</span>
      </header>
      <ol className="round-tools-list nowheel nodrag nopan">
        {groups.map((group) => (
          <li key={group.id} className="round-tools-list__item">
            <strong>{group.name}</strong>
            <span title={group.detail}>{group.detail || "No input"}</span>
            {group.status === "running" ? <LoadingIndicator label="Running" compact /> : null}
          </li>
        ))}
      </ol>
    </article>
  )
}
