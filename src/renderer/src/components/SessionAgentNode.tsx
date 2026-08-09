import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphAgent, GraphNodeStatus } from "../domain/graph"
import { spokeOffset } from "../projectors/sessionLayout"
import { LoadingIndicator } from "./LoadingIndicator"
import { MarkdownContent } from "./MarkdownContent"

export interface SessionAgentNodeData extends Record<string, unknown> {
  readonly id: string
  readonly agent: GraphAgent
  readonly status: GraphNodeStatus
  readonly subagentRoot: boolean
  readonly expanded: boolean
  readonly topBranches: ReadonlyArray<SessionBranchControl>
  readonly bottomBranches: ReadonlyArray<SessionBranchControl>
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly toggleBranch: (branchID: string, siblingIDs: ReadonlyArray<string>) => void
  readonly toggleExpanded: (id: string) => void
}

export interface SessionBranchControl {
  readonly id: string
  readonly visible: boolean
  readonly siblingIDs: ReadonlyArray<string>
}

export type SessionAgentFlowNode = Node<SessionAgentNodeData, "sessionAgent">

export function SessionAgentNode({ data }: NodeProps<SessionAgentFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const [canExpand, setCanExpand] = useState(false)
  const latestNarrative = data.agent.narratives.at(-1)
  const completed = data.status === "completed" || data.status === "error"
  const interactive = completed && canExpand
  const expanded = interactive && data.expanded
  const branchHandleSignature = `${data.topBranches.map((branch) => branch.id).join(":")}|${data.bottomBranches.map((branch) => branch.id).join(":")}`
  const toggle = () => {
    if (interactive) data.toggleExpanded(data.id)
  }

  useEffect(() => {
    const element = nodeRef.current
    if (element === null) return undefined
    const reportSize = () => data.reportSize(data.id, element.offsetWidth, element.offsetHeight)
    reportSize()
    const observer = new ResizeObserver(reportSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data.id, data.reportSize])

  useEffect(() => {
    updateNodeInternals(data.id)
  }, [branchHandleSignature, data.id, data.subagentRoot, updateNodeInternals])

  useEffect(() => {
    const content = nodeRef.current?.querySelector<HTMLElement>(".agent-node__text")
    setCanExpand(
      completed &&
        content !== undefined &&
        content !== null &&
        content.scrollHeight > content.clientHeight + 1,
    )
  }, [completed, latestNarrative?.detail])

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest("a, button, input, textarea, select") !== null
    )
      return
    toggle()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    toggle()
  }

  return (
    <article
      ref={nodeRef}
      className={`event-node agent-node${data.status === "running" ? " agent-node--running" : ""}${interactive ? " agent-node--interactive" : ""}${expanded ? " agent-node--expanded" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? expanded : undefined}
      aria-label={interactive ? `${expanded ? "Collapse" : "Expand"} agent response` : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {data.subagentRoot ? (
        <Handle id="subagent-target" type="target" position={Position.Bottom} />
      ) : null}
      <Handle id="timeline-target" type="target" position={Position.Left} />
      {data.topBranches.map((branch, index) => (
        <Handle
          key={branch.id}
          id={`read-source-${index}`}
          type="source"
          position={Position.Top}
          className={`branch-toggle branch-toggle--top${branch.visible ? " branch-toggle--visible" : ""}`}
          style={{ left: spokeOffset(index, data.topBranches.length) }}
          aria-label={`${branch.visible ? "Hide" : "Show"} upper branch`}
          onClick={(event) => {
            event.stopPropagation()
            data.toggleBranch(branch.id, branch.siblingIDs)
          }}
        />
      ))}
      <div className="event-node__heading">
        <span>Agent</span>
        <span className="agent-node__identity">
          {data.agent.agents.join(", ")} {data.agent.models.join(", ")}
        </span>
        {data.status === "running" ? <LoadingIndicator label="Working" compact /> : null}
      </div>
      {data.agent.errors.map((error, index) => (
        <p key={`${index}:${error}`} className="agent-node__error">
          {error}
        </p>
      ))}
      {latestNarrative === undefined ? (
        <p className="agent-node__text agent-node__text--empty">Waiting for the agent…</p>
      ) : (
        <MarkdownContent className="agent-node__text" source={latestNarrative.detail} />
      )}
      {interactive ? (
        <span className="agent-node__expand-prompt" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            {expanded ? (
              <path d="M2 2l4 4m0 0V3m0 3H3M14 14l-4-4m0 0v3m0-3h3" />
            ) : (
              <path d="M6 6 2 2m0 0v3m0-3h3M10 10l4 4m0 0v-3m0 3h-3" />
            )}
          </svg>
          {expanded ? "Collapse" : "Expand"}
        </span>
      ) : null}
      {data.bottomBranches.map((branch, index) => (
        <Handle
          key={branch.id}
          id={`write-source-${index}`}
          type="source"
          position={Position.Bottom}
          className={`branch-toggle branch-toggle--bottom${branch.visible ? " branch-toggle--visible" : ""}`}
          style={{ left: spokeOffset(index, data.bottomBranches.length) }}
          aria-label={`${branch.visible ? "Hide" : "Show"} lower branch`}
          onClick={(event) => {
            event.stopPropagation()
            data.toggleBranch(branch.id, branch.siblingIDs)
          }}
        />
      ))}
      <Handle id="timeline-source" type="source" position={Position.Right} />
    </article>
  )
}
