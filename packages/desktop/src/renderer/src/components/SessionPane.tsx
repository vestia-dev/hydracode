import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { Effect } from "effect"
import type { Question } from "@opencode-ai/client/effect"
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
  type Viewport,
} from "@xyflow/react"
import type { SemanticGraphNode } from "../domain/graph"
import {
  collapsedSubagentPosition,
  horizontalRoundSideNodePosition,
  roundBranchWidth,
  roundSideNodePosition,
  roundTimelineDistance,
  splitRoundToolsX,
  splitRoundToolsWidth,
  splitRoundSideNodeX,
  subagentTimelinePosition,
  timelinePositions,
} from "../domain/sessionLayout"
import { createPromptComposerState } from "../domain/sessionComposer"
import { classifyToolCall } from "../domain/sessionGraph"
import { matchSubagentLaunchers } from "../domain/projectSessions"
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
import { SessionQuestionNode, type SessionQuestionFlowNode } from "./SessionQuestionNode"
import { SessionSpokeEdge } from "./SessionSpokeEdge"
import { useTheme } from "../theme"
import { AppRuntime } from "../runtime"
import { recordStartupMeasure } from "../startupTiming"
import type { PaneUIState } from "../../../shared/applicationState"

const nodeTypes: NodeTypes = {
  sessionRound: SessionRoundNode,
  sessionRoundTools: SessionRoundToolsNode,
  sessionRoundArtifacts: SessionRoundArtifactsNode,
  sessionCollapsedSubagent: SessionCollapsedSubagentNode,
  sessionEvent: SessionEventNode,
  sessionPrompt: SessionPromptNode,
  sessionQuestion: SessionQuestionNode,
}

const edgeTypes: EdgeTypes = {
  sessionSpoke: SessionSpokeEdge,
}

interface SessionPaneProps {
  readonly session: SessionView
  readonly descendants: ReadonlyArray<SessionView>
  readonly directory: string
  readonly submitPrompt: (
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly backgroundSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly replyQuestion: (
    request: Question.Request,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly rejectQuestion: (
    request: Question.Request,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly retryPrompt: { readonly text: string; readonly message: string } | undefined
  readonly focusPromptRequest: number | undefined
  readonly followLatestRequest: number | undefined
  readonly uiState: PaneUIState | undefined
  readonly updateUIState: (update: Partial<Omit<PaneUIState, "paneID">>) => void
}

interface SessionCanvasProps extends SessionPaneProps {
  readonly followLatest: boolean
  readonly stopFamily: () => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly stopFollowing: () => void
}

type FlowNode =
  | SessionEventFlowNode
  | SessionRoundFlowNode
  | SessionRoundToolsFlowNode
  | SessionRoundArtifactsFlowNode
  | SessionCollapsedSubagentFlowNode
  | SessionPromptFlowNode
  | SessionQuestionFlowNode

interface CompletedFlowNodeCacheEntry {
  readonly source: SemanticGraphNode
  readonly layoutKey: string
  readonly node: FlowNode
}

function completedFlowNodeLayoutKey(node: FlowNode) {
  if (node.type === "sessionRound") {
    const data = node.data
    return [
      data.status,
      data.expanded,
      data.subagentRoot,
      data.hasTools,
      data.hasSubagents,
      data.hasShellResources,
      data.hasArtifacts,
      data.horizontalSides,
      data.collapseSubagent !== undefined,
    ].join(":")
  }
  if (node.type === "sessionRoundTools") {
    const data = node.data
    return [data.status, data.width, data.maxHeight, data.targetSide].join(":")
  }
  if (node.type === "sessionRoundArtifacts") {
    const data = node.data
    return [data.width, data.maxHeight, data.targetSide].join(":")
  }
  return undefined
}

function reuseCompletedFlowNodeData(node: FlowNode, cached: FlowNode) {
  if (node.type === "sessionRound" && cached.type === "sessionRound")
    Object.assign(node, { data: cached.data })
  else if (node.type === "sessionRoundTools" && cached.type === "sessionRoundTools")
    Object.assign(node, { data: cached.data })
  else if (node.type === "sessionRoundArtifacts" && cached.type === "sessionRoundArtifacts")
    Object.assign(node, { data: cached.data })
  return node
}

const ROUND_WIDTH = 420
const EVENT_WIDTH = 220
const PROMPT_WIDTH = 270
const QUESTION_WIDTH = 400
const ROUND_COLLAPSED_HEIGHT = 92

interface NodeSize {
  readonly width: number
  readonly height: number
}

interface ActivityShell {
  readonly command: string
  readonly executionMode: "foreground" | "background"
  readonly id: string
  readonly result?: string
  readonly running: boolean
  readonly status: string
}

interface ActivitySubagent {
  readonly agent: string
  readonly expanded: boolean
  readonly id: string
  readonly running: boolean
  readonly status: string
  readonly title: string
  readonly executionMode: "foreground" | "background"
}

interface ActivitySummary {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly width: number
  readonly subagents: Array<ActivitySubagent>
  readonly shells: ReadonlyArray<ActivityShell>
  readonly targetSide: "bottom" | "left" | "top"
}

function activityShells(node: SemanticGraphNode | undefined): ReadonlyArray<ActivityShell> {
  return (node?.roundTools?.calls ?? []).flatMap((call) => {
    const name = call.name.toLowerCase().replaceAll(/[-_]/g, "")
    if (name !== "shell" && name !== "bash") return []
    return [
      {
        command: call.detail,
        executionMode: call.executionMode ?? "foreground",
        id: call.id,
        ...(call.result === undefined ? {} : { result: call.result }),
        running: call.status === "running",
        status:
          call.status === "running"
            ? "Running"
            : call.status === "error"
              ? "Failed"
              : call.status === "completed"
                ? "Completed"
                : "Pending",
      },
    ]
  })
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
  hasShellResources: boolean,
  hasArtifacts: boolean,
  horizontalSides: boolean,
  expanded: boolean,
  collapseSubagent: (() => void) | undefined,
  background: (() => void) | undefined,
  stop: (() => void) | undefined,
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
      hasShellResources,
      hasArtifacts,
      horizontalSides,
      reportSize,
      toggleExpanded,
      ...(collapseSubagent === undefined ? {} : { collapseSubagent }),
      ...(background === undefined ? {} : { background }),
      ...(stop === undefined ? {} : { stop }),
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
  focusRequest: number | undefined,
  draft: string,
  setDraft: (draft: string) => void,
): SessionPromptFlowNode {
  return {
    id,
    type: "sessionPrompt",
    position,
    data: {
      agentRunning,
      promptPending,
      submitPrompt,
      draft,
      setDraft,
      ...(retryPrompt === undefined ? {} : { retryPrompt }),
      ...(focusRequest === undefined ? {} : { focusRequest }),
    },
  }
}

function questionFlowNode(
  id: string,
  position: { readonly x: number; readonly y: number },
  request: Question.Request,
  reply: (
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>,
  reject: () => Effect.Effect<void, DesktopBridgeError, DesktopBridge>,
  focusRequest: number | undefined,
): SessionQuestionFlowNode {
  return {
    id,
    type: "sessionQuestion",
    position,
    data: {
      request,
      reply,
      reject,
      ...(focusRequest === undefined ? {} : { focusRequest }),
    },
  }
}

function SessionCanvas({
  session,
  descendants,
  followLatest,
  stopFamily,
  stopFollowing,
  submitPrompt,
  backgroundSession,
  interruptSession,
  replyQuestion,
  rejectQuestion,
  retryPrompt,
  focusPromptRequest,
  followLatestRequest,
  uiState,
  updateUIState,
}: SessionCanvasProps) {
  const measuredNodeSizes = useRef(new Map<string, NonNullable<FlowNode["measured"]>>())
  const completedFlowNodeCache = useRef(new Map<string, CompletedFlowNodeCacheEntry>())
  const initialFlowRenderStarted = useRef(performance.now())
  const recordedNodeMeasurement = useRef(false)
  const appliedFocusPromptRequest = useRef<number | undefined>(undefined)
  const appliedFollowLatestRequest = useRef<number | undefined>(undefined)
  const [expandedRounds, setExpandedRounds] = useState<ReadonlySet<string>>(
    () => new Set(uiState?.expandedRoundIDs ?? []),
  )
  const [expandedSubagents, setExpandedSubagents] = useState<ReadonlySet<string>>(
    () => new Set(uiState?.expandedSubagentIDs ?? []),
  )
  const [roundSizes, setRoundSizes] = useState<ReadonlyMap<string, NodeSize>>(() => new Map())
  const [sideNodeSizes, setSideNodeSizes] = useState<ReadonlyMap<string, NodeSize>>(() => new Map())
  const nodeDistance = useTheme().layout.nodeDistance
  const updateUIStateEvent = useEffectEvent(updateUIState)

  useEffect(() => {
    updateUIStateEvent({ expandedRoundIDs: Array.from(expandedRounds) })
  }, [expandedRounds])

  useEffect(() => {
    updateUIStateEvent({ expandedSubagentIDs: Array.from(expandedSubagents) })
  }, [expandedSubagents])

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
  const retainMeasuredNodeSizes = useCallback(
    (changes: Array<NodeChange<FlowNode>>) => {
      let measured = 0
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions !== undefined) {
          measuredNodeSizes.current.set(change.id, change.dimensions)
          measured += 1
        }
      }
      if (measured > 0 && !recordedNodeMeasurement.current) {
        recordedNodeMeasurement.current = true
        recordStartupMeasure(
          "session-flow-time-to-node-measurement",
          initialFlowRenderStarted.current,
          {
            sessionID: session.id,
            nodes: measured,
          },
        )
      }
    },
    [session.id],
  )

  const flow = useMemo(() => {
    const started = performance.now()
    const sessions = [session, ...descendants]
    const questionRequest = sessions.flatMap((current) => current.questions)[0]
    const composerWidth = questionRequest === undefined ? PROMPT_WIDTH : QUESTION_WIDTH
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

    const composer = createPromptComposerState(session.id, session.graph.nodes)
    let composerPosition = { x: 0, y: 480 }
    const positions = new Map<string, { readonly x: number; readonly y: number }>()
    const childConnections: Array<{ readonly source: string; readonly target: string }> = []
    const shellConnections: Array<{ readonly source: string; readonly target: string }> = []
    const collapsedSubagents = new Map<string, ActivitySummary>()
    const shellResources = new Map<string, ActivitySummary>()
    const splitToolNodeIDs = new Set<string>()
    const splitArtifactNodeIDs = new Set<string>()
    const runningSubagentIDs = new Set<string>()
    const positionedSessions = new Set<string>()

    const positionSession = (
      current: SessionView,
      origin: { readonly x: number; readonly y: number },
    ) => {
      if (positionedSessions.has(current.id)) return
      positionedSessions.add(current.id)
      const timelineNodes = current.graph.nodes.filter((node) => !isRoundSideNode(node))
      const includeComposer = current.id === session.id
      const timeline = timelinePositions(
        [
          ...timelineNodes.map((node) => timelineNodeWidth(node, roundSizes)),
          ...(includeComposer ? [composerWidth] : []),
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
                      status: call.status,
                      executionMode: call.executionMode ?? "foreground",
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
      }
      for (const node of current.graph.nodes) {
        if (node.kind !== "round-tools" || activityShells(node).length === 0) continue
        const artifacts = current.graph.nodes.find(
          (candidate) =>
            candidate.kind === "round-artifacts" && candidate.agentRunID === node.agentRunID,
        )
        if (artifacts !== undefined && !horizontalSides) splitArtifactNodeIDs.add(artifacts.id)
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
        const shells = activityShells(tools)
        const lowerBranchCount = (artifacts === undefined ? 0 : 1) + (shells.length > 0 ? 1 : 0)
        if (artifacts !== undefined) {
          const split = splitArtifactNodeIDs.has(artifacts.id)
          const artifactsWidth = horizontalSides
            ? roundSize.width
            : roundBranchWidth(roundSize.width, nodeDistance.horizontal, lowerBranchCount)
          const artifactsSize = sideNodeSizes.get(artifacts.id) ?? {
            width: artifactsWidth,
            height: 180,
          }
          const artifactsPosition = horizontalSides
            ? horizontalRoundSideNodePosition(
                anchor,
                roundSize,
                { width: artifactsWidth, height: artifactsSize.height },
                nodeDistance.horizontal,
                "right",
              )
            : roundSideNodePosition(
                anchor,
                roundSize,
                artifactsSize.height,
                nodeDistance.vertical,
                "bottom",
              )
          positions.set(
            artifacts.id,
            split
              ? {
                  ...artifactsPosition,
                  x: splitRoundSideNodeX(anchor, roundSize.width, artifactsWidth, "left"),
                }
              : artifactsPosition,
          )
        }
        if (shells.length > 0) {
          const shellWidth = horizontalSides
            ? roundSize.width
            : roundBranchWidth(roundSize.width, nodeDistance.horizontal, lowerBranchCount)
          const shellID = `shell-resources:${round.id}`
          const shellSize = sideNodeSizes.get(shellID) ?? {
            width: shellWidth,
            height: Math.min(66 + shells.length * 31, 280),
          }
          const shellPosition = horizontalSides
            ? {
                x: anchor.x + roundSize.width + nodeDistance.horizontal,
                y:
                  anchor.y +
                  (artifacts === undefined
                    ? 0
                    : (sideNodeSizes.get(artifacts.id)?.height ?? 180) + nodeDistance.vertical),
              }
            : roundSideNodePosition(
                anchor,
                roundSize,
                shellSize.height,
                nodeDistance.vertical,
                "bottom",
              )
          shellResources.set(round.id, {
            id: shellID,
            position: horizontalSides
              ? shellPosition
              : {
                  ...shellPosition,
                  x:
                    artifacts === undefined
                      ? anchor.x
                      : splitRoundSideNodeX(anchor, roundSize.width, shellWidth, "right"),
                },
            width: shellWidth,
            subagents: [],
            shells,
            targetSide: horizontalSides ? "left" : "top",
          })
          shellConnections.push({ source: round.id, target: shellID })
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
          const running = child.active
          const status =
            child.execution._tag === "Retrying"
              ? `Retrying ${child.execution.attempt}`
              : child.execution._tag === "Failed"
                ? "Failed"
                : running
                  ? "Running"
                  : "Inactive"
          const subagent = {
            agent,
            expanded,
            id: child.id,
            running,
            status,
            title: child.title,
            executionMode: launcher.executionMode,
          }
          if (running) runningSubagentIDs.add(child.id)
          const existing = collapsedSubagents.get(parentRound.id)
          if (existing !== undefined) {
            existing.subagents.push(subagent)
          } else {
            const tools = current.graph.nodes.find((node) => node.id === launcher.nodeID)
            const toolsHeight =
              sideNodeSizes.get(launcher.nodeID)?.height ??
              42 + (tools?.roundTools?.calls.length ?? 0) * 31
            const toolsWidth = splitRoundToolsWidth(parentSize.width, nodeDistance.horizontal)
            const collapsedID = `subagents:${parentRound.id}`
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
              subagents: [subagent],
              shells: [],
              targetSide: "bottom",
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
          const latestRound = current.graph.nodes.findLast(
            (candidate) => candidate.kind === "round",
          )
          const status =
            runningSubagentIDs.has(current.id) && latestRound?.id === node.id
              ? "running"
              : node.status
          const hasTools = current.graph.nodes.some(
            (candidate) =>
              candidate.kind === "round-tools" &&
              candidate.agentRunID === node.agentRunID &&
              positions.has(candidate.id),
          )
          const backgroundableToolActive = current.graph.nodes
            .find(
              (candidate) =>
                candidate.kind === "round-tools" && candidate.agentRunID === node.agentRunID,
            )
            ?.roundTools?.calls.some((call) => {
              const name = call.name.toLowerCase().replaceAll(/[-_]/g, "")
              return (
                call.status === "running" &&
                (name === "shell" || name === "bash" || name === "subagent" || name === "task")
              )
            })
          const hasArtifacts = current.graph.nodes.some(
            (candidate) =>
              candidate.kind === "round-artifacts" &&
              candidate.agentRunID === node.agentRunID &&
              (candidate.roundArtifacts?.diff.files.length ?? 0) > 0 &&
              positions.has(candidate.id),
          )
          nodes.push(
            roundFlowNode(
              { ...node, status, round: node.round },
              position,
              subagentRootNodeIDs.has(node.id),
              hasTools,
              collapsedSubagents.has(node.id),
              shellResources.has(node.id),
              hasArtifacts,
              current.parentID !== undefined,
              expandedRounds.has(node.id),
              subagentRootNodeIDs.has(node.id) && expandedSubagents.has(current.id)
                ? () => toggleSubagent(current.id)
                : undefined,
              status === "running" && backgroundableToolActive === true
                ? () => AppRuntime.runFork(backgroundSession(current.id).pipe(Effect.ignore))
                : undefined,
              status === "running"
                ? () => {
                    AppRuntime.runFork(
                      (current.id === session.id
                        ? stopFamily()
                        : interruptSession(current.id)
                      ).pipe(Effect.ignore),
                    )
                  }
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
              width: splitArtifactNodeIDs.has(node.id)
                ? splitRoundToolsWidth(
                    roundSizes.get(node.agentRunID ?? "")?.width ?? ROUND_WIDTH,
                    nodeDistance.horizontal,
                  )
                : (roundSizes.get(node.agentRunID ?? "")?.width ?? ROUND_WIDTH),
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
          kind: "subagents",
          targetSide: collapsed.targetSide,
          subagents: collapsed.subagents.map((subagent) => ({
            ...subagent,
            toggle: () => toggleSubagent(subagent.id),
          })),
          shells: collapsed.shells,
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
    nodes.push(
      ...Array.from(shellResources.values(), (summary): SessionCollapsedSubagentFlowNode => ({
        id: summary.id,
        type: "sessionCollapsedSubagent",
        position: summary.position,
        data: {
          id: summary.id,
          kind: "shell-resources",
          targetSide: summary.targetSide,
          subagents: [],
          shells: summary.shells,
          width: summary.width,
          toggleAll: () => undefined,
          reportSize: reportSideNodeSize,
        },
      })),
    )
    nodes.push(
      questionRequest === undefined
        ? promptFlowNode(
            composer.id,
            composerPosition,
            sessions.some((current) => current.active),
            sessions.some((current) => current.optimisticPrompts.length > 0),
            (text) => submitPrompt(session.id, text),
            retryPrompt,
            focusPromptRequest,
            uiState?.draft ?? "",
            (draft) => updateUIState({ draft }),
          )
        : questionFlowNode(
            composer.id,
            composerPosition,
            questionRequest,
            (answers) => replyQuestion(questionRequest, answers),
            () => rejectQuestion(questionRequest),
            focusPromptRequest,
          ),
    )

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
    edges.push(
      ...shellConnections.map(({ source, target }) => ({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle: "shell-resources-source",
        targetHandle: "shell-resources-target",
        type: "sessionSpoke",
        className: "artifacts-edge",
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
    const semanticNodes = new Map(
      sessions.flatMap((current) => current.graph.nodes.map((node) => [node.id, node] as const)),
    )
    const nextCompletedFlowNodeCache = new Map<string, CompletedFlowNodeCacheEntry>()
    const stableNodes = nodes.map((node) => {
      const source = semanticNodes.get(node.id)
      const layoutKey = completedFlowNodeLayoutKey(node)
      if (
        source === undefined ||
        (source.status !== "completed" && source.status !== "error") ||
        layoutKey === undefined
      )
        return node
      const cached = completedFlowNodeCache.current.get(node.id)
      const stableNode =
        cached?.source === source && cached.layoutKey === layoutKey
          ? reuseCompletedFlowNodeData(node, cached.node)
          : node
      nextCompletedFlowNodeCache.set(node.id, { source, layoutKey, node: stableNode })
      return stableNode
    })
    completedFlowNodeCache.current = nextCompletedFlowNodeCache
    const result = {
      nodes: stableNodes.map((node) => {
        const measured = measuredNodeSizes.current.get(node.id)
        return measured === undefined ? node : Object.assign(node, { measured })
      }),
      edges,
      focusNodeID: composer.precedingNodeID,
      promptNodeID: composer.id,
    }
    recordStartupMeasure("session-flow-build", started, {
      sessions: sessions.length,
      nodes: result.nodes.length,
      edges: result.edges.length,
    })
    return result
  }, [
    descendants,
    expandedRounds,
    expandedSubagents,
    closeSubagents,
    nodeDistance,
    openSubagents,
    reportRoundSize,
    reportSideNodeSize,
    roundSizes,
    retryPrompt,
    replyQuestion,
    rejectQuestion,
    focusPromptRequest,
    backgroundSession,
    interruptSession,
    session,
    sideNodeSizes,
    stopFamily,
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

  useEffect(() => {
    if (focusPromptRequest === undefined || !reactFlow.viewportInitialized) return undefined
    if (appliedFocusPromptRequest.current === focusPromptRequest) return undefined
    appliedFocusPromptRequest.current = focusPromptRequest
    const frame = window.requestAnimationFrame(() => {
      if (followLatest) stopFollowing()
      void reactFlow.fitView({
        nodes: [{ id: flow.promptNodeID }],
        minZoom: 1,
        maxZoom: 1,
        padding: 0,
        duration: 220,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [flow.promptNodeID, focusPromptRequest, followLatest, reactFlow, stopFollowing])

  useEffect(() => {
    if (followLatestRequest === undefined) return undefined
    if (appliedFollowLatestRequest.current === followLatestRequest) return undefined
    appliedFollowLatestRequest.current = followLatestRequest
    const frame = window.requestAnimationFrame(() => centerLatest(220))
    return () => window.cancelAnimationFrame(frame)
  }, [centerLatest, followLatestRequest])

  return (
    <ReactFlow
      nodes={flow.nodes}
      edges={flow.edges}
      edgeTypes={edgeTypes}
      nodeTypes={nodeTypes}
      onNodesChange={retainMeasuredNodeSizes}
      nodesDraggable={false}
      nodesConnectable={false}
      onMove={(event) => {
        if (event !== null && followLatest) stopFollowing()
      }}
      onMoveEnd={(_event, viewport: Viewport) => updateUIState({ viewport })}
      {...(uiState?.viewport === undefined ? {} : { defaultViewport: uiState.viewport })}
      onInit={(instance) => {
        recordStartupMeasure(
          "session-flow-time-to-initialization",
          initialFlowRenderStarted.current,
          {
            sessionID: session.id,
            nodes: flow.nodes.length,
            edges: flow.edges.length,
          },
        )
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

export function SessionPane({
  session,
  descendants,
  directory,
  submitPrompt,
  replyQuestion,
  rejectQuestion,
  backgroundSession,
  interruptSession,
  retryPrompt,
  focusPromptRequest,
  followLatestRequest,
  uiState,
  updateUIState,
}: SessionPaneProps) {
  const sessions = [session, ...descendants]
  const [followLatest, setFollowLatest] = useState(uiState?.followLatest ?? true)
  const appliedFollowStateRequest = useRef<number | undefined>(undefined)
  const stopFollowing = useCallback(() => {
    setFollowLatest(false)
    updateUIState({ followLatest: false })
  }, [updateUIState])
  const submitPromptAndFollow = useCallback(
    (sessionID: SessionView["id"], text: string) => {
      setFollowLatest(true)
      updateUIState({ followLatest: true })
      return submitPrompt(sessionID, text)
    },
    [submitPrompt, updateUIState],
  )
  const stopFamily = useCallback(
    () =>
      Effect.forEach(descendants.toReversed(), (current) => interruptSession(current.id), {
        discard: true,
      }).pipe(Effect.andThen(interruptSession(session.id))),
    [descendants, interruptSession, session.id],
  )
  useEffect(() => {
    if (
      followLatestRequest === undefined ||
      appliedFollowStateRequest.current === followLatestRequest
    )
      return
    appliedFollowStateRequest.current = followLatestRequest
    setFollowLatest(true)
    updateUIState({ followLatest: true })
  }, [followLatestRequest, updateUIState])
  const active = sessions.some((current) => current.active)
  const retrying = sessions.find((current) => current.execution._tag === "Retrying")
  const failed = sessions.find((current) => current.execution._tag === "Failed")
  const executionLabel =
    retrying?.execution._tag === "Retrying"
      ? `Retrying attempt ${retrying.execution.attempt}`
      : active
        ? "Running"
        : failed?.execution._tag === "Failed"
          ? "Failed"
          : undefined

  return (
    <section className="session-pane" aria-label={`Session: ${session.title}`}>
      <div
        className={`session-heading${followLatest ? " session-heading--following" : ""}`}
        aria-label={followLatest ? "Following latest node" : undefined}
      >
        <span className="session-heading__identity">
          <strong>{session.title}</strong>
          <span className="session-heading__location" title={directory}>
            {directory}
          </span>
        </span>
        {executionLabel === undefined ? null : (
          <span className="session-heading__status">{executionLabel}</span>
        )}
      </div>
      <ReactFlowProvider>
        <SessionCanvas
          session={session}
          descendants={descendants}
          directory={directory}
          followLatest={followLatest}
          stopFamily={stopFamily}
          stopFollowing={stopFollowing}
          submitPrompt={submitPromptAndFollow}
          backgroundSession={backgroundSession}
          interruptSession={interruptSession}
          replyQuestion={replyQuestion}
          rejectQuestion={rejectQuestion}
          retryPrompt={retryPrompt}
          focusPromptRequest={focusPromptRequest}
          followLatestRequest={followLatestRequest}
          uiState={uiState}
          updateUIState={updateUIState}
        />
      </ReactFlowProvider>
    </section>
  )
}
