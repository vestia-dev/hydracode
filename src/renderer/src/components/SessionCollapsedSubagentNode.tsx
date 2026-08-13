import { useEffect, useRef } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"

export interface SessionCollapsedSubagentNodeData extends Record<string, unknown> {
  readonly id: string
  readonly toggleAll: () => void
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly subagents: ReadonlyArray<{
    readonly agent: string
    readonly expanded: boolean
    readonly id: string
    readonly running: boolean
    readonly toggle: () => void
  }>
  readonly width: number
}

export type SessionCollapsedSubagentFlowNode = Node<
  SessionCollapsedSubagentNodeData,
  "sessionCollapsedSubagent"
>

export function SessionCollapsedSubagentNode({
  data,
}: NodeProps<SessionCollapsedSubagentFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const count = data.subagents.length
  const allExpanded = data.subagents.every((subagent) => subagent.expanded)
  const running = data.subagents.some((subagent) => subagent.running)
  const allAction = allExpanded ? "Close all" : "Open all"

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
  }, [data.id, data.reportSize, data.width, updateNodeInternals])

  return (
    <article
      ref={nodeRef}
      className={`collapsed-subagent-node${running ? " collapsed-subagent-node--running" : ""}`}
      style={{ width: data.width }}
    >
      <Handle id="subagent-target" type="target" position={Position.Bottom} />
      <header className="round-side-node__heading collapsed-subagent-node__heading">
        <button
          className="nodrag nopan"
          type="button"
          aria-label={`${allAction} ${count} subagents`}
          onClick={data.toggleAll}
        >
          <strong>Subagents</strong>
          <span>{allAction}</span>
        </button>
      </header>
      <ol className="collapsed-subagent-list">
        {data.subagents.map((subagent) => (
          <li key={subagent.id}>
            <button
              className="nodrag nopan"
              type="button"
              aria-expanded={subagent.expanded}
              onClick={subagent.toggle}
            >
              <strong>{subagent.agent}</strong>
              <span>{subagent.expanded ? "Close" : "Open"}</span>
            </button>
          </li>
        ))}
      </ol>
    </article>
  )
}
