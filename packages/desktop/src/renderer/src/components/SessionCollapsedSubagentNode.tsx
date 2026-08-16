import { useEffect, useRef } from "react"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"

export interface SessionCollapsedSubagentNodeData extends Record<string, unknown> {
  readonly id: string
  readonly kind: "subagents" | "shell-resources"
  readonly targetSide: "bottom" | "left" | "top"
  readonly toggleAll: () => void
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly subagents: ReadonlyArray<{
    readonly agent: string
    readonly expanded: boolean
    readonly id: string
    readonly running: boolean
    readonly status: string
    readonly title: string
    readonly executionMode: "foreground" | "background"
    readonly toggle: () => void
  }>
  readonly shells: ReadonlyArray<{
    readonly command: string
    readonly executionMode: "foreground" | "background"
    readonly id: string
    readonly result?: string
    readonly status: string
    readonly running: boolean
  }>
  readonly width: number
}

export type SessionCollapsedSubagentFlowNode = Node<
  SessionCollapsedSubagentNodeData,
  "sessionCollapsedSubagent"
>

function modeLabel(mode: "foreground" | "background") {
  return mode === "background" ? "Background" : "Foreground"
}

function activityLabel(status: string, mode: "foreground" | "background") {
  return status === "Failed" || status.startsWith("Retrying")
    ? `${status} · ${modeLabel(mode)}`
    : modeLabel(mode)
}

export function SessionCollapsedSubagentNode({
  data,
}: NodeProps<SessionCollapsedSubagentFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()
  const subagents = data.kind === "subagents" ? data.subagents : []
  const shells = data.kind === "shell-resources" ? data.shells : []
  const count = subagents.length + shells.length
  const allExpanded = subagents.every((subagent) => subagent.expanded)
  const running =
    subagents.some((subagent) => subagent.running) || shells.some((shell) => shell.running)
  const activeCount =
    subagents.filter((subagent) => subagent.running).length +
    shells.filter((shell) => shell.running).length
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
      <Handle
        id={data.kind === "subagents" ? "subagent-target" : "shell-resources-target"}
        type="target"
        position={
          data.targetSide === "bottom"
            ? Position.Bottom
            : data.targetSide === "left"
              ? Position.Left
              : Position.Top
        }
      />
      <header className="round-side-node__heading collapsed-subagent-node__heading">
        <button
          className="nodrag nopan"
          type="button"
          aria-label={
            data.kind === "shell-resources"
              ? `Shell resources summary with ${shells.length} commands`
              : `${allAction} ${subagents.length} subagents`
          }
          disabled={data.kind === "shell-resources"}
          onClick={data.toggleAll}
        >
          <strong>{data.kind === "subagents" ? "Subagents" : "Shell resources"}</strong>
          <span>{activeCount > 0 ? `${activeCount} active` : `${count} items`}</span>
        </button>
      </header>
      <ol className="collapsed-subagent-list">
        {subagents.map((subagent) => (
          <li key={subagent.id}>
            <button
              className="nodrag nopan"
              type="button"
              aria-expanded={subagent.expanded}
              aria-label={`${subagent.expanded ? "Collapse" : "Expand"} ${subagent.agent} subagent: ${subagent.title}`}
              onClick={subagent.toggle}
            >
              <span className="collapsed-subagent-list__identity">
                <strong>{subagent.agent}</strong>
                <small>{subagent.title}</small>
              </span>
              <span
                className={`collapsed-subagent-list__status${subagent.running ? " collapsed-subagent-list__status--running" : ""}`}
                title={`${subagent.status} · ${modeLabel(subagent.executionMode)}`}
              >
                {activityLabel(subagent.status, subagent.executionMode)}
              </span>
            </button>
          </li>
        ))}
        {shells.map((shell) => (
          <li key={shell.id}>
            <div className="collapsed-subagent-list__shell nodrag nopan">
              <span className="collapsed-subagent-list__identity">
                <strong>Shell</strong>
                <small title={shell.command}>{shell.command}</small>
                {shell.result === undefined ? null : (
                  <small className="collapsed-subagent-list__result" title={shell.result}>
                    <b>Output</b> {shell.result}
                  </small>
                )}
              </span>
              <span
                className={`collapsed-subagent-list__status${shell.running ? " collapsed-subagent-list__status--running" : ""}`}
                title={`${shell.status} · ${modeLabel(shell.executionMode)}`}
              >
                {activityLabel(shell.status, shell.executionMode)}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </article>
  )
}
