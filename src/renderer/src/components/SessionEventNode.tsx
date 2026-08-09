import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import type { GraphNodeKind, GraphNodeStatus } from "../domain/graph"
import { MarkdownContent } from "./MarkdownContent"
import { LoadingIndicator } from "./LoadingIndicator"

export interface SessionEventNodeData extends Record<string, unknown> {
  readonly kind: GraphNodeKind
  readonly title: string
  readonly detail: string
  readonly status: GraphNodeStatus
  readonly subagent: boolean
  readonly subagentRoot: boolean
}

export type SessionEventFlowNode = Node<SessionEventNodeData, "sessionEvent">

export function SessionEventNode({ data }: NodeProps<SessionEventFlowNode>) {
  const detail = data.detail || "No details"

  return (
    <article
      className={`event-node event-node--${data.kind}${data.status === "running" ? " event-node--running" : ""}`}
    >
      <Handle id="timeline-target" type="target" position={Position.Left} />
      {data.subagentRoot ? (
        <Handle id="subagent-target" type="target" position={Position.Bottom} />
      ) : null}
      <div className="event-node__heading">
        <span>{data.title}</span>
        {data.status === "running" ? <LoadingIndicator label="Running" compact /> : null}
      </div>
      {data.kind === "shell" ? (
        <p>{detail}</p>
      ) : (
        <MarkdownContent className="event-node__text" source={detail} />
      )}
      <Handle id="timeline-source" type="source" position={Position.Right} />
    </article>
  )
}
