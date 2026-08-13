import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react"
import type { GraphNodeStatus, GraphRound } from "../domain/graph"
import { IconButton } from "./IconButton"
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
  readonly stop?: () => void
  readonly reportSize: (id: string, width: number, height: number) => void
  readonly toggleExpanded: (id: string) => void
}

export type SessionRoundFlowNode = Node<SessionRoundNodeData, "sessionRound">

export function SessionRoundNode({ data }: NodeProps<SessionRoundFlowNode>) {
  if (data.round.history.length > 0) return <HistoryRoundNode data={data} />
  if (data.collapseSubagent !== undefined) return <CollapsibleSubagentRoundNode data={data} />
  if (data.status === "completed" || data.status === "error")
    return <ExpandableRoundNode data={data} />
  return <StaticRoundNode data={data} />
}

function useRoundNodeRef(data: SessionRoundNodeData) {
  const nodeRef = useRef<HTMLElement>(null)
  const updateNodeInternals = useUpdateNodeInternals()

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

  return nodeRef
}

interface RoundNodeActivation {
  readonly label: string
  readonly onActivate: () => void
  readonly expanded?: boolean
  readonly hasPopup?: boolean
}

function RoundNodeSurface({
  data,
  nodeRef,
  activation,
  expanded = false,
  children,
}: {
  readonly data: SessionRoundNodeData
  readonly nodeRef: RefObject<HTMLElement | null>
  readonly activation?: RoundNodeActivation
  readonly expanded?: boolean
  readonly children?: ReactNode
}) {
  const latestNarrative = data.round.agent?.narratives.at(-1)
  const completed = data.status === "completed" || data.status === "error"

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (
      activation === undefined ||
      (event.target instanceof Element &&
        event.target.closest("a, button, input, textarea, select") !== null)
    )
      return
    activation.onActivate()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      activation === undefined ||
      (event.key !== "Enter" && event.key !== " ") ||
      (event.target instanceof Element &&
        event.target.closest("a, button, input, textarea, select") !== null)
    )
      return
    event.preventDefault()
    activation.onActivate()
  }

  return (
    <article
      ref={nodeRef}
      className={`event-node agent-node round-node${data.status === "running" ? " agent-node--running" : ""}${activation === undefined ? "" : " agent-node--interactive"}${expanded ? " agent-node--expanded" : ""}`}
      role={activation === undefined ? undefined : "button"}
      tabIndex={activation === undefined ? undefined : 0}
      aria-expanded={activation?.expanded}
      aria-haspopup={activation?.hasPopup ? "dialog" : undefined}
      aria-label={activation?.label}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <RoundNodeHandles data={data} />
      {data.stop === undefined ? null : (
        <IconButton
          type="button"
          className="round-node__stop-button nodrag nopan"
          label="Stop session"
          variant="ghost"
          onClick={data.stop}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="5" y="5" width="6" height="6" rx="0.75" />
          </svg>
        </IconButton>
      )}
      {data.round.agent === undefined && data.status !== "running" ? null : (
        <div className="event-node__heading">
          {data.round.agent === undefined ? null : (
            <span className="agent-node__identity">{data.round.agent.agents.join(", ")}</span>
          )}
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
      {children}
    </article>
  )
}

function RoundNodeHandles({ data }: { readonly data: SessionRoundNodeData }) {
  return (
    <>
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
      {data.hasArtifacts ? (
        <Handle
          id="artifacts-source"
          type="source"
          position={data.horizontalSides ? Position.Right : Position.Bottom}
          style={data.horizontalSides ? { top: "50%" } : undefined}
        />
      ) : null}
      <Handle id="timeline-source" type="source" position={Position.Right} />
    </>
  )
}

function StaticRoundNode({ data }: { readonly data: SessionRoundNodeData }) {
  const nodeRef = useRoundNodeRef(data)
  return <RoundNodeSurface data={data} nodeRef={nodeRef} />
}

function CollapsibleSubagentRoundNode({ data }: { readonly data: SessionRoundNodeData }) {
  const nodeRef = useRoundNodeRef(data)
  const collapse = data.collapseSubagent
  if (collapse === undefined) return <RoundNodeSurface data={data} nodeRef={nodeRef} />
  return (
    <RoundNodeSurface
      data={data}
      nodeRef={nodeRef}
      activation={{ label: "Collapse subagent", onActivate: collapse }}
    />
  )
}

function ExpandableRoundNode({ data }: { readonly data: SessionRoundNodeData }) {
  const nodeRef = useRoundNodeRef(data)
  const canExpand = useCanExpand(nodeRef, data.round.agent?.narratives.at(-1)?.detail)

  const expanded = canExpand && data.expanded
  return (
    <RoundNodeSurface
      data={data}
      nodeRef={nodeRef}
      expanded={expanded}
      {...(canExpand
        ? {
            activation: {
              label: `${expanded ? "Collapse" : "Expand"} round response`,
              onActivate: () => data.toggleExpanded(data.id),
              expanded,
            },
          }
        : {})}
    >
      {canExpand ? <ExpandPrompt expanded={expanded} /> : null}
    </RoundNodeSurface>
  )
}

function useCanExpand(nodeRef: RefObject<HTMLElement | null>, contentDetail?: string) {
  const [canExpand, setCanExpand] = useState(false)

  useEffect(() => {
    const content = nodeRef.current?.querySelector<HTMLElement>(".agent-node__text")
    setCanExpand(
      content !== undefined && content !== null && content.scrollHeight > content.clientHeight + 1,
    )
  }, [contentDetail, nodeRef])

  return canExpand
}

function ExpandPrompt({ expanded }: { readonly expanded: boolean }) {
  return (
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
  )
}

function HistoryRoundNode({ data }: { readonly data: SessionRoundNodeData }) {
  const nodeRef = useRoundNodeRef(data)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const canExpand = useCanExpand(nodeRef, data.round.agent?.narratives.at(-1)?.detail)
  const expanded = canExpand && data.expanded

  return (
    <>
      <RoundNodeSurface
        data={data}
        nodeRef={nodeRef}
        expanded={expanded}
        {...(canExpand
          ? {
              activation: {
                label: `${expanded ? "Collapse" : "Expand"} round response`,
                onActivate: () => data.toggleExpanded(data.id),
                expanded,
              },
            }
          : {})}
      >
        <IconButton
          ref={historyButtonRef}
          type="button"
          className={`round-node__history-button nodrag nopan${data.stop === undefined ? "" : " round-node__history-button--with-stop"}`}
          label="View message history"
          variant="ghost"
          aria-haspopup="dialog"
          onClick={() => setHistoryOpen(true)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v4M8 4.75v.5" />
          </svg>
        </IconButton>
        {canExpand ? <ExpandPrompt expanded={expanded} /> : null}
      </RoundNodeSurface>
      <RoundHistoryDialog
        data={data}
        open={historyOpen}
        returnFocusRef={historyButtonRef}
        close={() => setHistoryOpen(false)}
      />
    </>
  )
}

function RoundHistoryDialog({
  data,
  open,
  returnFocusRef,
  close,
}: {
  readonly data: SessionRoundNodeData
  readonly open: boolean
  readonly returnFocusRef: RefObject<HTMLElement | null>
  readonly close: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleID = useId()
  const closeDialog = useEffectEvent(close)

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
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
        closeDialog()
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
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [open, returnFocusRef])

  if (!open) return null
  return createPortal(
    <div
      className="round-history-backdrop nodrag nopan"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={dialogRef}
        className="round-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
        tabIndex={-1}
      >
        <header className="round-history__heading">
          <div>
            <span id={titleID}>Message history</span>
            <small>{data.round.history.length} entries</small>
          </div>
          <button type="button" aria-label="Close message history" onClick={close}>
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
}
