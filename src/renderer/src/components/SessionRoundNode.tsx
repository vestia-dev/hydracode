import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphNodeStatus, GraphRound } from "../domain/graph"
import { LoadingIndicator } from "./LoadingIndicator"
import { MarkdownContent } from "./MarkdownContent"

export interface SessionRoundNodeData extends Record<string, unknown> {
  readonly id: string
  readonly round: GraphRound
  readonly status: GraphNodeStatus
  readonly subagentRoot: boolean
  readonly hasTools: boolean
  readonly hasSubagents: boolean
  readonly hasArtifacts: boolean
  readonly horizontalSides: boolean
  readonly expanded: boolean
  readonly collapseSubagent?: () => void
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly toggleExpanded: (id: string) => void
}

export type SessionRoundFlowNode = Node<SessionRoundNodeData, "sessionRound">

export function SessionRoundNode({ data }: NodeProps<SessionRoundFlowNode>) {
  const nodeRef = useRef<HTMLElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const historyDialogRef = useRef<HTMLElement>(null)
  const historyTitleID = useId()
  const updateNodeInternals = useUpdateNodeInternals()
  const [canExpand, setCanExpand] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const latestNarrative = data.round.agent?.narratives.at(-1)
  const completed = data.status === "completed" || data.status === "error"
  const interactive = completed && canExpand
  const expanded = interactive && data.expanded
  const clickable = data.collapseSubagent !== undefined || interactive
  const toggle = () => {
    if (data.collapseSubagent !== undefined) {
      data.collapseSubagent()
      return
    }
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
  }, [
    data.hasSubagents,
    data.hasTools,
    data.horizontalSides,
    data.id,
    data.subagentRoot,
    updateNodeInternals,
  ])

  useEffect(() => {
    const content = nodeRef.current?.querySelector<HTMLElement>(".agent-node__text")
    setCanExpand(
      completed &&
        content !== undefined &&
        content !== null &&
        content.scrollHeight > content.clientHeight + 1,
    )
  }, [completed, latestNarrative?.detail])

  useEffect(() => {
    if (!historyOpen) return undefined
    const dialog = historyDialogRef.current
    if (dialog === null) return undefined
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    ;(focusable[0] ?? dialog).focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setHistoryOpen(false)
        return
      }
      if (event.key !== "Tab") return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        dialog.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      if (historyButtonRef.current?.isConnected) historyButtonRef.current.focus()
    }
  }, [historyOpen])

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
      className={`event-node agent-node round-node${data.status === "running" ? " agent-node--running" : ""}${clickable ? " agent-node--interactive" : ""}${expanded ? " agent-node--expanded" : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={data.collapseSubagent === undefined && interactive ? expanded : undefined}
      aria-label={
        data.collapseSubagent !== undefined
          ? "Collapse subagent"
          : interactive
            ? `${expanded ? "Collapse" : "Expand"} round response`
            : undefined
      }
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {data.subagentRoot ? (
        <Handle id="subagent-target" type="target" position={Position.Bottom} />
      ) : null}
      <Handle id="timeline-target" type="target" position={Position.Left} />
      {data.hasTools ? (
        <Handle
          id="tools-source"
          type="source"
          position={data.horizontalSides ? Position.Left : Position.Top}
          style={
            data.horizontalSides ? { top: "50%" } : { left: data.hasSubagents ? "25%" : "50%" }
          }
        />
      ) : null}
      {data.hasSubagents ? (
        <Handle
          id="subagent-source"
          type="source"
          position={Position.Top}
          style={{ left: "75%" }}
        />
      ) : null}
      {data.round.agent === undefined && data.status !== "running" ? null : (
        <div className="event-node__heading">
          {data.round.agent === undefined ? null : (
            <span className="agent-node__identity">{data.round.agent.agents.join(", ")}</span>
          )}
          {data.status === "running" ? <LoadingIndicator label="Working" compact /> : null}
        </div>
      )}
      {data.round.input === undefined ? null : (
        <div className="round-node__prompt">
          <MarkdownContent source={data.round.input.text} />
        </div>
      )}
      {data.round.agent?.errors.map((error, index) => (
        <p key={`${index}:${error}`} className="agent-node__error">
          {error}
        </p>
      ))}
      {latestNarrative === undefined ? (
        <p className="agent-node__text agent-node__text--empty">
          {completed && data.round.agent !== undefined ? "Completed" : "Waiting for the agent…"}
        </p>
      ) : (
        <MarkdownContent
          className={`agent-node__text agent-node__text--${latestNarrative.kind}`}
          source={latestNarrative.detail}
        />
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
      {data.round.history.length === 0 ? null : (
        <button
          ref={historyButtonRef}
          type="button"
          className="round-node__history-button nodrag nopan"
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation()
            setHistoryOpen(true)
          }}
        >
          View history
        </button>
      )}
      {data.hasArtifacts ? (
        <Handle
          id="artifacts-source"
          type="source"
          position={data.horizontalSides ? Position.Right : Position.Bottom}
          style={data.horizontalSides ? { top: "50%" } : undefined}
        />
      ) : null}
      <Handle id="timeline-source" type="source" position={Position.Right} />
      {historyOpen
        ? createPortal(
            <div
              className="round-history-backdrop nodrag nopan"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setHistoryOpen(false)
              }}
            >
              <section
                ref={historyDialogRef}
                className="round-history"
                role="dialog"
                aria-modal="true"
                aria-labelledby={historyTitleID}
                tabIndex={-1}
              >
                <header className="round-history__heading">
                  <div>
                    <span id={historyTitleID}>Message history</span>
                    <small>{data.round.history.length} entries</small>
                  </div>
                  <button
                    type="button"
                    aria-label="Close message history"
                    onClick={() => setHistoryOpen(false)}
                  >
                    Close
                  </button>
                </header>
                <div className="round-history__entries">
                  {data.round.history.map((item) => (
                    <article
                      key={item.id}
                      className={`round-history__entry round-history__entry--${item.kind}`}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.kind}</span>
                      </div>
                      <MarkdownContent source={item.detail} />
                    </article>
                  ))}
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </article>
  )
}
