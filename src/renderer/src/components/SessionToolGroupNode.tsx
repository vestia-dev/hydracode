import { useEffect, useRef } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphMessageToolGroup, GraphToolCall } from "../domain/graph"
import {
  groupToolCalls,
  toolCallExpansionKey,
  toolGroupExpansionKey,
  type GroupedToolCalls,
} from "../projectors/toolCallGroups"
import { ToolPatchDiff } from "./ToolPatchDiff"
import { LoadingIndicator } from "./LoadingIndicator"

export interface SessionToolGroupNodeData extends Record<string, unknown> {
  readonly expandedGroups: ReadonlySet<string>
  readonly id: string
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly toggleGroup: (key: string) => void
  readonly toolGroup: GraphMessageToolGroup
}

export type SessionToolGroupFlowNode = Node<SessionToolGroupNodeData, "sessionToolGroup">

interface ToolCallSummaryProps {
  readonly call: GraphToolCall
  readonly open: boolean
  readonly toggle: () => void
}

function ToolCallSummary({ call, open, toggle }: ToolCallSummaryProps) {
  const content = (
    <>
      <strong>{call.name}</strong>
      <span className="tool-group-call__detail">{call.detail || "No input"}</span>
      <span className="tool-call-group__actions">
        {call.status === "running" ? <LoadingIndicator label="Running" compact /> : null}
        {call.diff === undefined ? null : (
          <span
            className={`tool-call-group__chevron${open ? " tool-call-group__chevron--expanded" : ""}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 10 10">
              <path d="m3 2 3 3-3 3" />
            </svg>
          </span>
        )}
      </span>
    </>
  )

  return call.diff === undefined ? (
    <div className="tool-call-group__summary">{content}</div>
  ) : (
    <button
      className="tool-call-group__summary nodrag nopan"
      type="button"
      aria-expanded={open}
      onClick={toggle}
    >
      {content}
    </button>
  )
}

interface ToolCallRowProps {
  readonly call: GraphToolCall
  readonly expansionKey: string
  readonly expanded: boolean
  readonly toggleGroup: (key: string) => void
}

function ToolCallRow({ call, expanded, expansionKey, toggleGroup }: ToolCallRowProps) {
  return (
    <>
      <ToolCallSummary call={call} open={expanded} toggle={() => toggleGroup(expansionKey)} />
      {call.diff === undefined ? null : <ToolPatchDiff diff={call.diff} open={expanded} />}
    </>
  )
}

interface ToolCallGroupRowProps {
  readonly expandedGroups: ReadonlySet<string>
  readonly group: GroupedToolCalls
  readonly toolGroupID: string
  readonly toggleGroup: (key: string) => void
}

function ToolCallGroupRow({
  expandedGroups,
  group,
  toolGroupID,
  toggleGroup,
}: ToolCallGroupRowProps) {
  const repeated = group.calls.length > 1
  const groupKey = toolGroupExpansionKey(toolGroupID, group.name)
  const groupOpen = repeated && expandedGroups.has(groupKey)

  if (!repeated) {
    const call = group.calls[0]
    if (call === undefined) return null
    const callKey = toolCallExpansionKey(toolGroupID, call.id)
    return (
      <li className="tool-call-group">
        <ToolCallRow
          call={call}
          expanded={expandedGroups.has(callKey)}
          expansionKey={callKey}
          toggleGroup={toggleGroup}
        />
      </li>
    )
  }

  return (
    <li className="tool-call-group">
      <button
        className="tool-call-group__summary nodrag nopan"
        type="button"
        aria-expanded={groupOpen}
        onClick={() => toggleGroup(groupKey)}
      >
        <strong>
          {group.calls.length} × {group.name}
        </strong>
        <span className="tool-group-call__detail" />
        <span className="tool-call-group__actions">
          {group.status === "running" ? <LoadingIndicator label="Running" compact /> : null}
          <span
            className={`tool-call-group__chevron${groupOpen ? " tool-call-group__chevron--expanded" : ""}`}
            aria-hidden="true"
          >
            <svg viewBox="0 0 10 10">
              <path d="m3 2 3 3-3 3" />
            </svg>
          </span>
        </span>
      </button>
      {groupOpen ? (
        <ol className="individual-tool-call-list">
          {group.calls.map((call) => {
            const callKey = toolCallExpansionKey(toolGroupID, call.id)
            return (
              <li key={call.id}>
                <ToolCallRow
                  call={call}
                  expanded={expandedGroups.has(callKey)}
                  expansionKey={callKey}
                  toggleGroup={toggleGroup}
                />
              </li>
            )
          })}
        </ol>
      ) : null}
    </li>
  )
}

export function SessionToolGroupNode({ data }: NodeProps<SessionToolGroupFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const isTopBranch = data.toolGroup.direction !== "write"
  const groupedCalls = groupToolCalls(data.toolGroup.calls)
  const hasDiff = data.toolGroup.calls.some((call) => call.diff !== undefined)

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
  }, [data.id, data.reportSize, updateNodeInternals])

  return (
    <article
      ref={nodeRef}
      className={`event-node tool-group-node tool-group-node--${data.toolGroup.direction}${data.toolGroup.status === "running" ? " tool-group-node--running" : ""}${hasDiff ? " tool-group-node--has-diff" : ""}`}
    >
      <Handle
        id={`${data.toolGroup.direction}-root-target`}
        type="target"
        position={isTopBranch ? Position.Bottom : Position.Top}
      />
      <ol className="tool-group-call-list">
        {groupedCalls.map((group) => (
          <ToolCallGroupRow
            key={group.name}
            expandedGroups={data.expandedGroups}
            group={group}
            toolGroupID={data.toolGroup.id}
            toggleGroup={data.toggleGroup}
          />
        ))}
      </ol>
    </article>
  )
}
