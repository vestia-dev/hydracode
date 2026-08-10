import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Effect } from "effect"
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react"
import type { SemanticGraphNode } from "../domain/graph"
import { toolLayoutFixture } from "../fixtures/toolLayoutFixture"
import {
  collapsedSubagentPosition,
  horizontalRoundSideNodePosition,
  roundSideNodePosition,
  roundTimelineDistance,
  splitRoundToolsX,
  splitRoundToolsWidth,
  subagentTimelinePosition,
  timelinePositions,
} from "../projectors/sessionLayout"
import { projectPromptComposer } from "../projectors/sessionComposer"
import { classifyToolCall } from "../projectors/sessionGraph"
import { matchSubagentLaunchers } from "../projectors/projectSessions"
import type { SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { SessionRoundNode, type SessionRoundFlowNode } from "./SessionRoundNode"
import {
  SessionRoundArtifactsNode,
  type SessionRoundArtifactsFlowNode,
} from "./SessionRoundArtifactsNode"
import { SessionRoundToolsNode, type SessionRoundToolsFlowNode } from "./SessionRoundToolsNode"
import {
  SessionCollapsedSubagentNode,
  type SessionCollapsedSubagentFlowNode,
} from "./SessionCollapsedSubagentNode"
import { SessionEventNode, type SessionEventFlowNode } from "./SessionEventNode"
import { SessionPromptNode, type SessionPromptFlowNode } from "./SessionPromptNode"
import { SessionSpokeEdge } from "./SessionSpokeEdge"
import { useTheme } from "../theme"
import { AppRuntime } from "../runtime"

const nodeTypes: NodeTypes = {
  sessionRound: SessionRoundNode,
  sessionRoundTools: SessionRoundToolsNode,
  sessionRoundArtifacts: SessionRoundArtifactsNode,
  sessionCollapsedSubagent: SessionCollapsedSubagentNode,
  sessionEvent: SessionEventNode,
  sessionPrompt: SessionPromptNode,
}

const edgeTypes: EdgeTypes = {
  sessionSpoke: SessionSpokeEdge,
}

interface SessionPaneProps {
  readonly session: SessionView
  readonly descendants: ReadonlyArray<SessionView>
  readonly submitPrompt: (
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly retryPrompt: { readonly text: string; readonly message: string } | undefined
}

interface SessionCanvasProps extends SessionPaneProps {
  readonly followLatest: boolean
  readonly layoutLab: boolean
  readonly stopFollowing: () => void
}

type FlowNode =
  | SessionEventFlowNode
  | SessionRoundFlowNode
  | SessionRoundToolsFlowNode
  | SessionRoundArtifactsFlowNode
  | SessionCollapsedSubagentFlowNode
  | SessionPromptFlowNode

const ROUND_WIDTH = 420
const EVENT_WIDTH = 220
const PROMPT_WIDTH = 270
const ROUND_COLLAPSED_HEIGHT = 92

interface NodeSize {
  readonly width: number
  readonly height: number
}

function isRoundSideNode(node: SemanticGraphNode) {
  return node.kind === "round-tools" || node.kind === "round-artifacts"
}

function timelineNodeWidth(node: SemanticGraphNode, roundSizes: ReadonlyMap<string, NodeSize>) {
  return node.kind === "round" ? (roundSizes.get(node.id)?.width ?? ROUND_WIDTH) : EVENT_WIDTH
}

function eventFlowNode(
  node: SemanticGraphNode,
  position: { readonly x: number; readonly y: number },
  subagent: boolean,
  subagentRoot: boolean,
): SessionEventFlowNode {
  return {
    id: node.id,
    type: "sessionEvent",
    position,
    data: {
      kind: node.kind,
      title: subagent && node.kind === "input" ? "Subagent" : node.title,
      detail: node.detail,
      status: node.status,
      subagent,
      subagentRoot,
    },
  }
}

function roundFlowNode(
  node: SemanticGraphNode & { readonly round: NonNullable<SemanticGraphNode["round"]> },
  position: { readonly x: number; readonly y: number },
  subagentRoot: boolean,
  hasTools: boolean,
  hasSubagents: boolean,
  hasArtifacts: boolean,
  horizontalSides: boolean,
  expanded: boolean,
  collapseSubagent: (() => void) | undefined,
  reportSize: (id: string, width: number, height: number) => void,
  toggleExpanded: (id: string) => void,
): SessionRoundFlowNode {
  return {
    id: node.id,
    type: "sessionRound",
    position,
    data: {
      id: node.id,
      round: node.round,
      status: node.status,
      expanded,
      subagentRoot,
      hasTools,
      hasSubagents,
      hasArtifacts,
      horizontalSides,
      reportSize,
      toggleExpanded,
      ...(collapseSubagent === undefined ? {} : { collapseSubagent }),
    },
  }
}

function promptFlowNode(
  id: string,
  position: { readonly x: number; readonly y: number },
  agentRunning: boolean,
  promptPending: boolean,
  submitPrompt: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>,
  retryPrompt: { readonly text: string; readonly message: string } | undefined,
): SessionPromptFlowNode {
  return {
    id,
    type: "sessionPrompt",
    position,
    data: {
      agentRunning,
      promptPending,
      submitPrompt,
      ...(retryPrompt === undefined ? {} : { retryPrompt }),
    },
  }
}

function SessionCanvas({
  session,
  descendants,
  followLatest,
  layoutLab,
  stopFollowing,
  submitPrompt,
  retryPrompt,
}: SessionCanvasProps) {
  const measuredNodeSizes = useRef(new Map<string, NonNullable<FlowNode["measured"]>>())
  const [expandedRounds, setExpandedRounds] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedSubagents, setExpandedSubagents] = useState<ReadonlySet<string>>(() => new Set())
  const [roundSizes, setRoundSizes] = useState<ReadonlyMap<string, NodeSize>>(() => new Map())
  const [sideNodeSizes, setSideNodeSizes] = useState<ReadonlyMap<string, NodeSize>>(() => new Map())
  const nodeDistance = useTheme().layout.nodeDistance

  const toggleRound = useCallback((id: string) => {
    setExpandedRounds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleSubagent = useCallback((id: string) => {
    setExpandedSubagents((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const openSubagents = useCallback((ids: ReadonlyArray<string>) => {
    setExpandedSubagents((current) => {
      const next = new Set(current)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])
  const closeSubagents = useCallback((ids: ReadonlyArray<string>) => {
    setExpandedSubagents((current) => {
      const next = new Set(current)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [])
  const reportRoundSize = useCallback((id: string, width: number, height: number) => {
    setRoundSizes((current) => {
      const currentSize = current.get(id)
      if (currentSize?.width === width && currentSize.height === height) return current
      const next = new Map(current)
      next.set(id, { width, height })
      return next
    })
  }, [])
  const reportSideNodeSize = useCallback((id: string, width: number, height: number) => {
    setSideNodeSizes((current) => {
      const currentSize = current.get(id)
      if (currentSize?.width === width && currentSize.height === height) return current
      const next = new Map(current)
      next.set(id, { width, height })
      return next
    })
  }, [])
  const retainMeasuredNodeSizes = useCallback((changes: Array<NodeChange<FlowNode>>) => {
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions !== undefined) {
        measuredNodeSizes.current.set(change.id, change.dimensions)
      }
    }
  }, [])

  const flow = useMemo(() => {
    const sessions = [session, ...descendants]
    const timelineDistance = roundTimelineDistance(nodeDistance)
    const subagentRootNodeIDs = new Set(
      descendants.flatMap((current) => {
        const first = current.graph.nodes.find((node) => !isRoundSideNode(node))
        return first === undefined ? [] : [first.id]
      }),
    )
    const descendantsByParent = new Map<string, Array<SessionView>>()
    for (const child of descendants) {
      if (child.parentID === undefined) continue
      const siblings = descendantsByParent.get(child.parentID) ?? []
      siblings.push(child)
      descendantsByParent.set(child.parentID, siblings)
    }

    const composer = projectPromptComposer(session.id, session.graph.nodes)
    let composerPosition = { x: 0, y: 480 }
    const positions = new Map<string, { readonly x: number; readonly y: number }>()
    const childConnections: Array<{ readonly source: string; readonly target: string }> = []
    const collapsedSubagents = new Map<
      string,
      {
        readonly id: string
        readonly position: { readonly x: number; readonly y: number }
        readonly width: number
        readonly subagents: Array<{
          readonly agent: string
          readonly expanded: boolean
          readonly id: string
        }>
      }
    >()
    const splitToolNodeIDs = new Set<string>()
    const subagentRoundIDs = new Set<string>()
    const positionedSessions = new Set<string>()

    const positionSession = (
      current: SessionView,
      origin: { readonly x: number; readonly y: number },
    ) => {
      if (positionedSessions.has(current.id)) return
      positionedSessions.add(current.id)
      const timelineNodes = current.graph.nodes.filter((node) => !isRoundSideNode(node))
      const includeComposer = current.id === session.id && !layoutLab
      const timeline = timelinePositions(
        [
          ...timelineNodes.map((node) => timelineNodeWidth(node, roundSizes)),
          ...(includeComposer ? [PROMPT_WIDTH] : []),
        ],
        timelineDistance,
        origin,
      )
      timelineNodes.forEach((node, index) => {
        const position = timeline[index]
        if (position !== undefined) positions.set(node.id, position)
      })
      if (includeComposer) composerPosition = timeline.at(-1) ?? origin
      const horizontalSides = current.parentID !== undefined

      const children = descendantsByParent.get(current.id) ?? []
      const launchers = current.graph.nodes.flatMap((node) => {
        const roundID = node.agentRunID
        return node.roundTools === undefined || roundID === undefined
          ? []
          : node.roundTools.calls.flatMap((call) =>
              classifyToolCall(call.name, call.input) !== "subagent"
                ? []
                : [
                    {
                      id: call.id,
                      nodeID: node.id,
                      roundID,
                      created: call.time.created,
                      sessionIDs:
                        call.subagentSessionID === undefined ? [] : [call.subagentSessionID],
                    },
                  ],
            )
      })
      const launchersByChild = matchSubagentLaunchers(children, launchers)
      const matchedLauncherIDs = new Set(launchersByChild.values())
      for (const launcher of launchers) {
        if (!matchedLauncherIDs.has(launcher.id)) continue
        splitToolNodeIDs.add(launcher.nodeID)
        subagentRoundIDs.add(launcher.roundID)
      }

      for (const round of timelineNodes.filter((node) => node.kind === "round")) {
        const anchor = positions.get(round.id)
        if (anchor === undefined) continue
        const roundSize = roundSizes.get(round.id) ?? {
          width: ROUND_WIDTH,
          height: ROUND_COLLAPSED_HEIGHT,
        }
        const tools = current.graph.nodes.find(
          (node) => node.kind === "round-tools" && node.agentRunID === round.agentRunID,
        )
        const artifacts = current.graph.nodes.find(
          (node) => node.kind === "round-artifacts" && node.agentRunID === round.agentRunID,
        )
        if (tools !== undefined) {
          const toolsHeight =
            sideNodeSizes.get(tools.id)?.height ?? 42 + (tools.roundTools?.calls.length ?? 0) * 31
          const split = splitToolNodeIDs.has(tools.id)
          const toolsWidth = split
            ? splitRoundToolsWidth(roundSize.width, nodeDistance.horizontal)
            : roundSize.width
          const toolsPosition = horizontalSides
            ? horizontalRoundSideNodePosition(
                anchor,
                roundSize,
                { width: toolsWidth, height: toolsHeight },
                nodeDistance.horizontal,
                "left",
              )
            : roundSideNodePosition(anchor, roundSize, toolsHeight, nodeDistance.vertical, "top")
          positions.set(
            tools.id,
            split && !horizontalSides
              ? {
                  ...toolsPosition,
                  x: splitRoundToolsX(anchor, roundSize.width, toolsWidth),
                }
              : toolsPosition,
          )
        }
        if (artifacts !== undefined) {
          const artifactsSize = sideNodeSizes.get(artifacts.id) ?? {
            width: roundSize.width,
            height: 180,
          }
          positions.set(
            artifacts.id,
            horizontalSides
              ? horizontalRoundSideNodePosition(
                  anchor,
                  roundSize,
                  { width: roundSize.width, height: artifactsSize.height },
                  nodeDistance.horizontal,
                  "right",
                )
              : roundSideNodePosition(
                  anchor,
                  roundSize,
                  artifactsSize.height,
                  nodeDistance.vertical,
                  "bottom",
                ),
          )
        }
      }

      const precedingChildHeightsByRound = new Map<string, Array<number>>()
      children
        .toSorted((left, right) => left.created - right.created)
        .forEach((child) => {
          const launcherID = launchersByChild.get(child.id)
          const launcher = launchers.find((candidate) => candidate.id === launcherID)
          const firstChildNode = child.graph.nodes.find((node) => !isRoundSideNode(node))
          const parentRound =
            launcher === undefined
              ? undefined
              : current.graph.nodes.find((node) => node.id === launcher.roundID)
          const parentPosition =
            parentRound === undefined ? undefined : positions.get(parentRound.id)
          const toolsPosition = launcher === undefined ? undefined : positions.get(launcher.nodeID)
          if (
            launcher === undefined ||
            parentRound === undefined ||
            parentPosition === undefined ||
            toolsPosition === undefined ||
            firstChildNode === undefined
          )
            return
          const parentSize = roundSizes.get(parentRound.id) ?? {
            width: ROUND_WIDTH,
            height: ROUND_COLLAPSED_HEIGHT,
          }
          const childWidth = timelineNodeWidth(firstChildNode, roundSizes)
          const childHeight = Math.max(
            ROUND_COLLAPSED_HEIGHT,
            ...child.graph.nodes
              .filter((node) => node.kind === "round")
              .map((node) => roundSizes.get(node.id)?.height ?? ROUND_COLLAPSED_HEIGHT),
          )
          const precedingChildHeights = precedingChildHeightsByRound.get(parentRound.id) ?? []
          const agent =
            firstChildNode.round?.agent?.agents.join(", ") || firstChildNode.title || "Subagent"
          const expanded = expandedSubagents.has(child.id)
          const existing = collapsedSubagents.get(parentRound.id)
          if (existing !== undefined) {
            existing.subagents.push({ agent, expanded, id: child.id })
          } else {
            const tools = current.graph.nodes.find((node) => node.id === launcher.nodeID)
            const toolsHeight =
              sideNodeSizes.get(launcher.nodeID)?.height ??
              42 + (tools?.roundTools?.calls.length ?? 0) * 31
            const toolsWidth = splitRoundToolsWidth(parentSize.width, nodeDistance.horizontal)
            const collapsedID = `collapsed-subagents:${parentRound.id}`
            const collapsedSize = sideNodeSizes.get(collapsedID) ?? {
              width: toolsWidth,
              height: 66,
            }
            collapsedSubagents.set(parentRound.id, {
              id: collapsedID,
              position: collapsedSubagentPosition(
                parentPosition,
                parentSize.width,
                toolsPosition,
                { width: toolsWidth, height: toolsHeight },
                collapsedSize,
              ),
              width: toolsWidth,
              subagents: [{ agent, expanded, id: child.id }],
            })
            childConnections.push({ source: parentRound.id, target: collapsedID })
          }
          if (!expanded) {
            return
          }
          childConnections.push({ source: parentRound.id, target: firstChildNode.id })
          positionSession(
            child,
            subagentTimelinePosition(
              parentPosition,
              parentSize,
              toolsPosition,
              { width: childWidth, height: childHeight },
              precedingChildHeights,
              nodeDistance,
            ),
          )
          precedingChildHeights.push(childHeight)
          precedingChildHeightsByRound.set(parentRound.id, precedingChildHeights)
        })
    }

    positionSession(session, { x: 0, y: 480 })

    const nodes: Array<FlowNode> = []
    for (const current of sessions) {
      for (const node of current.graph.nodes) {
        const position = positions.get(node.id)
        if (position === undefined) continue
        if (node.kind === "round" && node.round !== undefined) {
          const hasTools = current.graph.nodes.some(
            (candidate) =>
              candidate.kind === "round-tools" && candidate.agentRunID === node.agentRunID,
          )
          const hasArtifacts = current.graph.nodes.some(
            (candidate) =>
              candidate.kind === "round-artifacts" && candidate.agentRunID === node.agentRunID,
          )
          nodes.push(
            roundFlowNode(
              { ...node, round: node.round },
              position,
              subagentRootNodeIDs.has(node.id),
              hasTools,
              subagentRoundIDs.has(node.id),
              hasArtifacts,
              current.parentID !== undefined,
              expandedRounds.has(node.id),
              subagentRootNodeIDs.has(node.id) && expandedSubagents.has(current.id)
                ? () => toggleSubagent(current.id)
                : undefined,
              reportRoundSize,
              toggleRound,
            ),
          )
        } else if (node.kind === "round-tools" && node.roundTools !== undefined) {
          const roundWidth = roundSizes.get(node.agentRunID ?? "")?.width ?? ROUND_WIDTH
          nodes.push({
            id: node.id,
            type: "sessionRoundTools",
            position,
            data: {
              id: node.id,
              width: splitToolNodeIDs.has(node.id)
                ? splitRoundToolsWidth(roundWidth, nodeDistance.horizontal)
                : roundWidth,
              status: node.status,
              targetSide: current.parentID === undefined ? "bottom" : "right",
              tools: node.roundTools,
              ...(current.parentID === undefined
                ? {}
                : {
                    maxHeight:
                      roundSizes.get(node.agentRunID ?? "")?.height ?? ROUND_COLLAPSED_HEIGHT,
                  }),
              reportSize: reportSideNodeSize,
            },
          })
        } else if (node.kind === "round-artifacts" && node.roundArtifacts !== undefined) {
          nodes.push({
            id: node.id,
            type: "sessionRoundArtifacts",
            position,
            data: {
              id: node.id,
              width: roundSizes.get(node.agentRunID ?? "")?.width ?? ROUND_WIDTH,
              artifacts: node.roundArtifacts,
              targetSide: current.parentID === undefined ? "top" : "left",
              ...(current.parentID === undefined
                ? {}
                : {
                    maxHeight:
                      roundSizes.get(node.agentRunID ?? "")?.height ?? ROUND_COLLAPSED_HEIGHT,
                  }),
              reportSize: reportSideNodeSize,
            },
          })
        } else {
          nodes.push(
            eventFlowNode(
              node,
              position,
              current.parentID !== undefined,
              subagentRootNodeIDs.has(node.id),
            ),
          )
        }
      }
    }
    nodes.push(
      ...Array.from(collapsedSubagents.values(), (collapsed): SessionCollapsedSubagentFlowNode => ({
        id: collapsed.id,
        type: "sessionCollapsedSubagent",
        position: collapsed.position,
        data: {
          id: collapsed.id,
          subagents: collapsed.subagents.map((subagent) => ({
            ...subagent,
            toggle: () => toggleSubagent(subagent.id),
          })),
          width: collapsed.width,
          toggleAll: () => {
            const ids = collapsed.subagents.map((subagent) => subagent.id)
            if (collapsed.subagents.every((subagent) => subagent.expanded)) closeSubagents(ids)
            else openSubagents(ids)
          },
          reportSize: reportSideNodeSize,
        },
      })),
    )
    if (!layoutLab) {
      nodes.push(
        promptFlowNode(
          composer.id,
          composerPosition,
          sessions.some((current) => current.active),
          sessions.some((current) => current.optimisticPrompts.length > 0),
          (text) => submitPrompt(session.id, text),
          retryPrompt,
        ),
      )
    }

    const edges: Array<Edge> = sessions
      .flatMap((current) => current.graph.edges)
      .filter((edge) => positions.has(edge.source) && positions.has(edge.target))
      .map((edge) => {
        if (edge.kind === "tools") {
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: "tools-source",
            targetHandle: "tools-target",
            type: "sessionSpoke",
            className: "tools-edge",
          }
        }
        if (edge.kind === "artifacts") {
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: "artifacts-source",
            targetHandle: "artifacts-target",
            type: "sessionSpoke",
            className: "artifacts-edge",
          }
        }
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: "timeline-source",
          targetHandle: "timeline-target",
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        }
      })
    edges.push(
      ...childConnections.map(({ source, target }) => ({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle: "subagent-source",
        targetHandle: "subagent-target",
        type: "sessionSpoke",
        className: "subagent-edge",
      })),
    )
    if (composer.precedingNodeID !== undefined) {
      edges.push({
        id: `${composer.precedingNodeID}->${composer.id}`,
        source: composer.precedingNodeID,
        target: composer.id,
        sourceHandle: "timeline-source",
        targetHandle: "timeline-target",
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      })
    }
    return {
      nodes: nodes.map((node) => {
        const measured = measuredNodeSizes.current.get(node.id)
        return measured === undefined ? node : Object.assign(node, { measured })
      }),
      edges,
      focusNodeID: layoutLab
        ? session.graph.nodes.find((node) => node.kind === "round")?.id
        : composer.precedingNodeID,
    }
  }, [
    descendants,
    expandedRounds,
    expandedSubagents,
    closeSubagents,
    layoutLab,
    nodeDistance,
    openSubagents,
    reportRoundSize,
    reportSideNodeSize,
    roundSizes,
    retryPrompt,
    session,
    sideNodeSizes,
    submitPrompt,
    toggleRound,
    toggleSubagent,
  ])

  const reactFlow = useReactFlow<FlowNode>()
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const centerLatest = useCallback(
    (duration: number) => {
      if (!reactFlow.viewportInitialized || flow.focusNodeID === undefined) return
      void reactFlow.fitView({
        nodes: [{ id: flow.focusNodeID }],
        minZoom: 1,
        maxZoom: 1,
        padding: 0,
        duration,
      })
    },
    [flow.focusNodeID, reactFlow],
  )

  useEffect(() => {
    if (!followLatest) return undefined
    const frame = window.requestAnimationFrame(() => centerLatest(220))
    return () => window.cancelAnimationFrame(frame)
  }, [centerLatest, followLatest, paneHeight, paneWidth])

  return (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      edgeTypes={edgeTypes}
      nodeTypes={nodeTypes}
      onNodesChange={retainMeasuredNodeSizes}
      nodesDraggable={false}
      nodesConnectable={false}
      onMoveStart={(event) => {
        if (event !== null && followLatest) stopFollowing()
      }}
      onInit={(instance) => {
        const focusNodeID = flow.focusNodeID
        if (!followLatest || focusNodeID === undefined) return
        window.requestAnimationFrame(() => {
          void instance.fitView({
            nodes: [{ id: focusNodeID }],
            minZoom: 1,
            maxZoom: 1,
            padding: 0,
          })
        })
      }}
      minZoom={0.2}
      maxZoom={1.5}
      panOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-grid)" />
    </ReactFlow>
  )
}

function sessionCounts(sessions: ReadonlyArray<SessionView>) {
  const agentMessageIDs = new Set<string>()
  let toolCallCount = 0
  for (const session of sessions) {
    for (const node of session.graph.nodes) {
      for (const messageID of node.agent?.messageIDs ?? []) agentMessageIDs.add(messageID)
      toolCallCount += node.roundTools?.calls.length ?? 0
    }
  }
  return { agentMessageCount: agentMessageIDs.size, toolCallCount }
}

export function SessionPane({
  session,
  descendants,
  submitPrompt,
  interruptSession,
  retryPrompt,
}: SessionPaneProps) {
  const sessions = [session, ...descendants]
  const [interrupting, setInterrupting] = useState(false)
  const [interruptError, setInterruptError] = useState<string | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [layoutLab, setLayoutLab] = useState(false)
  const stopFollowing = useCallback(() => setFollowLatest(false), [])
  const displayedSession = layoutLab ? toolLayoutFixture(session) : session
  const displayedDescendants = layoutLab ? [] : descendants
  const counts = sessionCounts([displayedSession])
  const active = layoutLab ? false : sessions.some((current) => current.active)
  const retrying = sessions.find((current) => current.execution._tag === "Retrying")
  const failed = sessions.find((current) => current.execution._tag === "Failed")
  const executionLabel = layoutLab
    ? "Synthetic fixture"
    : retrying?.execution._tag === "Retrying"
      ? `Retrying attempt ${retrying.execution.attempt}`
      : active
        ? "Running"
        : failed?.execution._tag === "Failed"
          ? "Failed"
          : "Idle"

  return (
    <section className="session-pane" aria-label={`Session: ${session.title}`}>
      <div className="session-heading">
        <span className={active ? "session-live-dot" : "session-idle-dot"} />
        <strong>{displayedSession.title}</strong>
        <span>
          {executionLabel} · {counts.agentMessageCount}{" "}
          {counts.agentMessageCount === 1 ? "agent message" : "agent messages"} ·{" "}
          {counts.toolCallCount} {counts.toolCallCount === 1 ? "tool call" : "tool calls"}
        </span>
        <button
          type="button"
          className={`session-layout-lab-button${layoutLab ? " session-layout-lab-button--active" : ""}`}
          aria-pressed={layoutLab}
          onClick={() => {
            setLayoutLab((current) => !current)
            setFollowLatest(true)
          }}
        >
          Layout lab
        </button>
        <button
          type="button"
          className={`session-follow-button${followLatest ? " session-follow-button--active" : ""}`}
          aria-pressed={followLatest}
          aria-label={followLatest ? "Stop following latest node" : "Follow latest node"}
          title={followLatest ? "Stop following latest node" : "Follow latest node"}
          onClick={() => setFollowLatest((current) => !current)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="4" />
            <circle cx="8" cy="8" r="1" />
            <path d="M8 1v14M1 8h14" />
          </svg>
        </button>
        {active ? (
          <button
            type="button"
            className="open-project-button"
            disabled={interrupting}
            onClick={() => {
              setInterrupting(true)
              setInterruptError(null)
              AppRuntime.runFork(
                interruptSession(session.id).pipe(
                  Effect.tap(() => Effect.sync(() => setInterrupting(false))),
                  Effect.catch((error) =>
                    Effect.sync(() => {
                      setInterrupting(false)
                      setInterruptError(error.message)
                    }),
                  ),
                ),
              )
            }}
          >
            {interrupting ? "Stopping" : "Stop"}
          </button>
        ) : null}
        {interruptError === null ? null : <span role="alert">{interruptError}</span>}
      </div>
      <ReactFlowProvider key={layoutLab ? "layout-lab" : "session"}>
        <SessionCanvas
          session={displayedSession}
          descendants={displayedDescendants}
          followLatest={followLatest}
          layoutLab={layoutLab}
          stopFollowing={stopFollowing}
          submitPrompt={submitPrompt}
          interruptSession={interruptSession}
          retryPrompt={retryPrompt}
        />
      </ReactFlowProvider>
    </section>
  )
}
