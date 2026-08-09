import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import type { GraphToolDirection, SemanticGraphNode } from "../domain/graph"
import {
  readBranchPositions,
  subagentTimelinePosition,
  timelinePositions,
  writeBranchPositions,
} from "../projectors/sessionLayout"
import { projectPromptComposer } from "../projectors/sessionComposer"
import { activateNewBranches, toggleBranchVisibility } from "../projectors/branchVisibility"
import { visibleToolRowCount } from "../projectors/toolCallGroups"
import { matchSubagentLaunchers } from "../projectors/workspaceSessions"
import type { SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import {
  SessionAgentNode,
  type SessionAgentFlowNode,
  type SessionBranchControl,
} from "./SessionAgentNode"
import { SessionEventNode, type SessionEventFlowNode } from "./SessionEventNode"
import { SessionPromptNode, type SessionPromptFlowNode } from "./SessionPromptNode"
import { SessionSpokeEdge } from "./SessionSpokeEdge"
import { SessionToolGroupNode, type SessionToolGroupFlowNode } from "./SessionToolGroupNode"
import { useTheme } from "../theme"
import { AppRuntime } from "../runtime"

const nodeTypes: NodeTypes = {
  sessionAgent: SessionAgentNode,
  sessionEvent: SessionEventNode,
  sessionPrompt: SessionPromptNode,
  sessionToolGroup: SessionToolGroupNode,
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
}

interface SessionCanvasProps extends SessionPaneProps {
  readonly followLatest: boolean
  readonly stopFollowing: () => void
}

type FlowNode =
  | SessionEventFlowNode
  | SessionAgentFlowNode
  | SessionPromptFlowNode
  | SessionToolGroupFlowNode

const AGENT_WIDTH = 420
const EVENT_WIDTH = 220
const PROMPT_WIDTH = 270
const TOOL_GROUP_WIDTH = 240
const AGENT_COLLAPSED_HEIGHT = 92

interface AgentSize {
  readonly width: number
  readonly height: number
}

function timelineNodeWidth(node: SemanticGraphNode, agentSizes: ReadonlyMap<string, AgentSize>) {
  return node.kind === "agent" ? (agentSizes.get(node.id)?.width ?? AGENT_WIDTH) : EVENT_WIDTH
}

function estimatedToolGroupSize(node: SemanticGraphNode, expandedGroups: ReadonlySet<string>) {
  const rowCount =
    node.toolGroup === undefined
      ? 0
      : visibleToolRowCount(node.toolGroup.id, node.toolGroup.calls, expandedGroups)
  return { width: TOOL_GROUP_WIDTH, height: 16 + rowCount * 31 }
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

function agentFlowNode(
  node: SemanticGraphNode & { readonly agent: NonNullable<SemanticGraphNode["agent"]> },
  position: { readonly x: number; readonly y: number },
  topBranches: ReadonlyArray<SessionBranchControl>,
  bottomBranches: ReadonlyArray<SessionBranchControl>,
  subagentRoot: boolean,
  expanded: boolean,
  reportSize: (id: string, width: number, height: number) => void,
  toggleBranch: (branchID: string, siblingIDs: ReadonlyArray<string>) => void,
  toggleExpanded: (id: string) => void,
): SessionAgentFlowNode {
  return {
    id: node.id,
    type: "sessionAgent",
    position,
    data: {
      id: node.id,
      agent: node.agent,
      status: node.status,
      expanded,
      topBranches,
      bottomBranches,
      subagentRoot,
      reportSize,
      toggleBranch,
      toggleExpanded,
    },
  }
}

function toolGroupFlowNode(
  node: SemanticGraphNode & {
    readonly toolGroup: NonNullable<SemanticGraphNode["toolGroup"]>
  },
  position: { readonly x: number; readonly y: number },
  expandedGroups: ReadonlySet<string>,
  reportSize: (id: string, width: number, height: number) => void,
  toggleGroup: (key: string) => void,
): SessionToolGroupFlowNode {
  return {
    id: node.id,
    type: "sessionToolGroup",
    position,
    data: { id: node.id, expandedGroups, reportSize, toggleGroup, toolGroup: node.toolGroup },
  }
}

function promptFlowNode(
  id: string,
  position: { readonly x: number; readonly y: number },
  agentRunning: boolean,
  submitPrompt: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>,
): SessionPromptFlowNode {
  return {
    id,
    type: "sessionPrompt",
    position,
    data: { agentRunning, submitPrompt },
  }
}

function branchNodes(
  nodes: ReadonlyArray<SemanticGraphNode>,
  agentRunID: string,
  direction: GraphToolDirection,
) {
  return nodes
    .filter((node) => node.agentRunID === agentRunID && node.toolGroup?.direction === direction)
    .toSorted((left, right) => (left.branchIndex ?? 0) - (right.branchIndex ?? 0))
}

function SessionCanvas({
  session,
  descendants,
  followLatest,
  stopFollowing,
  submitPrompt,
}: SessionCanvasProps) {
  const measuredNodeSizes = useRef(new Map<string, NonNullable<FlowNode["measured"]>>())
  const knownBranchIDs = useRef<ReadonlySet<string> | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedAgents, setExpandedAgents] = useState<ReadonlySet<string>>(() => new Set())
  const [hiddenBranches, setHiddenBranches] = useState<ReadonlySet<string>>(() => new Set())
  const [agentSizes, setAgentSizes] = useState<ReadonlyMap<string, AgentSize>>(() => new Map())
  const [toolGroupSizes, setToolGroupSizes] = useState<ReadonlyMap<string, AgentSize>>(
    () => new Map(),
  )
  const nodeDistance = useTheme().layout.nodeDistance
  const branchGroups = useMemo(
    () =>
      [session, ...descendants].flatMap((current) => [
        current.graph.nodes
          .filter(
            (node) =>
              node.toolGroup?.direction === "read" || node.toolGroup?.direction === "subagent",
          )
          .map((node) => node.id),
        current.graph.nodes
          .filter((node) => node.toolGroup?.direction === "write")
          .map((node) => node.id),
      ]),
    [descendants, session],
  )

  useLayoutEffect(() => {
    const currentBranchIDs = new Set(branchGroups.flat())
    const known = knownBranchIDs.current
    knownBranchIDs.current = currentBranchIDs
    setHiddenBranches((current) =>
      known === null ? currentBranchIDs : activateNewBranches(current, known, branchGroups),
    )
  }, [branchGroups])
  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const toggleAgent = useCallback((id: string) => {
    setExpandedAgents((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const toggleBranch = useCallback((branchID: string, siblingIDs: ReadonlyArray<string>) => {
    setHiddenBranches((current) => toggleBranchVisibility(current, branchID, siblingIDs))
  }, [])
  const reportAgentSize = useCallback((id: string, width: number, height: number) => {
    setAgentSizes((current) => {
      const currentSize = current.get(id)
      if (currentSize?.width === width && currentSize.height === height) return current
      const next = new Map(current)
      next.set(id, { width, height })
      return next
    })
  }, [])
  const reportToolGroupSize = useCallback((id: string, width: number, height: number) => {
    setToolGroupSizes((current) => {
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
    const subagentRootNodeIDs = new Set(
      descendants.flatMap((current) => {
        const first = current.graph.nodes.find((node) => node.kind !== "tool-group")
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
    const branchControls = new Map<
      string,
      {
        readonly top: ReadonlyArray<SessionBranchControl>
        readonly bottom: ReadonlyArray<SessionBranchControl>
      }
    >()
    const branchSiblingIDs = new Map<string, ReadonlyArray<string>>()
    const topBranchIndexes = new Map<string, number>()
    const bottomBranchIndexes = new Map<string, number>()
    const childConnections: Array<{
      readonly branchID: string
      readonly source: string
      readonly sourceIndex: number
      readonly target: string
    }> = []
    const positionedSessions = new Set<string>()

    const positionSession = (
      current: SessionView,
      origin: { readonly x: number; readonly y: number },
    ) => {
      if (positionedSessions.has(current.id)) return
      positionedSessions.add(current.id)
      const timelineNodes = current.graph.nodes.filter((node) => node.kind !== "tool-group")
      const includeComposer = current.id === session.id
      const timeline = timelinePositions(
        [
          ...timelineNodes.map((node) => timelineNodeWidth(node, agentSizes)),
          ...(includeComposer ? [PROMPT_WIDTH] : []),
        ],
        nodeDistance,
        origin,
      )
      timelineNodes.forEach((node, index) => {
        const position = timeline[index]
        if (position !== undefined) positions.set(node.id, position)
      })
      if (includeComposer) composerPosition = timeline.at(-1) ?? origin

      const topSiblingIDs = current.graph.nodes
        .filter(
          (node) =>
            node.toolGroup?.direction === "read" || node.toolGroup?.direction === "subagent",
        )
        .map((node) => node.id)
      const bottomSiblingIDs = current.graph.nodes
        .filter((node) => node.toolGroup?.direction === "write")
        .map((node) => node.id)
      for (const branchID of topSiblingIDs) branchSiblingIDs.set(branchID, topSiblingIDs)
      for (const branchID of bottomSiblingIDs) branchSiblingIDs.set(branchID, bottomSiblingIDs)

      for (const agentNode of timelineNodes) {
        if (agentNode.kind !== "agent" || agentNode.agentRunID === undefined) continue
        const anchor = positions.get(agentNode.id)
        if (anchor === undefined) continue
        const allReads = branchNodes(current.graph.nodes, agentNode.agentRunID, "read")
        const subagents = branchNodes(current.graph.nodes, agentNode.agentRunID, "subagent")
        const topBranches = [...allReads, ...subagents].toSorted(
          (left, right) => (left.time?.created ?? 0) - (right.time?.created ?? 0),
        )
        const allWrites = branchNodes(current.graph.nodes, agentNode.agentRunID, "write")
        const reads = allReads.filter((node) => !hiddenBranches.has(node.id))
        const writes = allWrites.filter((node) => !hiddenBranches.has(node.id))
        const agentSize = agentSizes.get(agentNode.id)
        branchControls.set(agentNode.id, {
          top: topBranches.map((node) => ({
            id: node.id,
            visible: !hiddenBranches.has(node.id),
            siblingIDs: topSiblingIDs,
          })),
          bottom: allWrites.map((node) => ({
            id: node.id,
            visible: !hiddenBranches.has(node.id),
            siblingIDs: bottomSiblingIDs,
          })),
        })
        topBranches.forEach((node, index) => topBranchIndexes.set(node.id, index))
        allWrites.forEach((node, index) => bottomBranchIndexes.set(node.id, index))
        const readPositions = readBranchPositions(
          anchor,
          agentSize?.width ?? AGENT_WIDTH,
          reads.map(
            (node) => toolGroupSizes.get(node.id) ?? estimatedToolGroupSize(node, expandedGroups),
          ),
          nodeDistance,
        )
        const writePositions = writeBranchPositions(
          anchor,
          agentSize?.width ?? AGENT_WIDTH,
          agentSize?.height ?? AGENT_COLLAPSED_HEIGHT,
          writes.map(
            (node) => toolGroupSizes.get(node.id) ?? estimatedToolGroupSize(node, expandedGroups),
          ),
          nodeDistance,
        )
        reads.forEach((node, index) => {
          const position = readPositions[index]
          if (position !== undefined) positions.set(node.id, position)
        })
        writes.forEach((node, index) => {
          const position = writePositions[index]
          if (position !== undefined) positions.set(node.id, position)
        })
      }

      const children = descendantsByParent.get(current.id) ?? []
      const subagentNodes = current.graph.nodes.filter(
        (node) => node.toolGroup?.direction === "subagent",
      )
      const launchersByChild = matchSubagentLaunchers(
        children,
        subagentNodes.map((node) => ({
          id: node.id,
          created: node.time?.created ?? 0,
          sessionIDs:
            node.toolGroup?.calls.flatMap((call) =>
              call.subagentSessionID === undefined ? [] : [call.subagentSessionID],
            ) ?? [],
        })),
      )
      const precedingChildHeights: Array<number> = []
      children
        .toSorted((left, right) => left.created - right.created)
        .forEach((child) => {
          const launcherID = launchersByChild.get(child.id)
          const taskNode = subagentNodes.find((node) => node.id === launcherID)
          const parentAgent = current.graph.nodes.find(
            (node) => node.kind === "agent" && node.agentRunID === taskNode?.agentRunID,
          )
          const parentPosition =
            parentAgent === undefined ? undefined : positions.get(parentAgent.id)
          const firstChildNode = child.graph.nodes.find((node) => node.kind !== "tool-group")
          if (
            taskNode === undefined ||
            hiddenBranches.has(taskNode.id) ||
            parentAgent === undefined ||
            parentPosition === undefined ||
            firstChildNode === undefined
          )
            return
          childConnections.push({
            branchID: taskNode.id,
            source: parentAgent.id,
            sourceIndex: topBranchIndexes.get(taskNode.id) ?? 0,
            target: firstChildNode.id,
          })
          const parentWidth = agentSizes.get(parentAgent.id)?.width ?? AGENT_WIDTH
          const childWidth = timelineNodeWidth(firstChildNode, agentSizes)
          const childHeight = Math.max(
            AGENT_COLLAPSED_HEIGHT,
            ...child.graph.nodes
              .filter((node) => node.kind === "agent")
              .map((node) => agentSizes.get(node.id)?.height ?? AGENT_COLLAPSED_HEIGHT),
          )
          positionSession(
            child,
            subagentTimelinePosition(
              parentPosition,
              parentWidth,
              childWidth,
              childHeight,
              precedingChildHeights,
              nodeDistance,
            ),
          )
          precedingChildHeights.push(childHeight)
        })
    }

    positionSession(session, { x: 0, y: 480 })

    const nodes: Array<FlowNode> = []
    for (const current of sessions) {
      for (const node of current.graph.nodes) {
        const position = positions.get(node.id)
        if (position === undefined) continue
        if (node.kind === "agent" && node.agent !== undefined) {
          const controls = branchControls.get(node.id) ?? { top: [], bottom: [] }
          nodes.push(
            agentFlowNode(
              { ...node, agent: node.agent },
              position,
              controls.top,
              controls.bottom,
              subagentRootNodeIDs.has(node.id),
              expandedAgents.has(node.id),
              reportAgentSize,
              toggleBranch,
              toggleAgent,
            ),
          )
        } else if (node.kind === "tool-group" && node.toolGroup !== undefined) {
          if (node.toolGroup.direction === "subagent") continue
          nodes.push(
            toolGroupFlowNode(
              { ...node, toolGroup: node.toolGroup },
              position,
              expandedGroups,
              reportToolGroupSize,
              toggleGroup,
            ),
          )
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
      promptFlowNode(
        composer.id,
        composerPosition,
        sessions.some((current) => current.active),
        (text) => submitPrompt(session.id, text),
      ),
    )

    const edges: Array<Edge> = sessions
      .flatMap((current) => current.graph.edges)
      .filter((edge) => edge.kind !== "subagent")
      .filter((edge) => positions.has(edge.source) && positions.has(edge.target))
      .map((edge) => {
        if (edge.kind === "read") {
          const spokeIndex = topBranchIndexes.get(edge.target) ?? 0
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: `read-source-${spokeIndex}`,
            targetHandle: "read-root-target",
            type: "sessionSpoke",
            className: "read-edge",
            data: {
              toggleBranch: () =>
                toggleBranch(edge.target, branchSiblingIDs.get(edge.target) ?? []),
            },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          }
        }
        if (edge.kind === "write") {
          const spokeIndex = bottomBranchIndexes.get(edge.target) ?? 0
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: `write-source-${spokeIndex}`,
            targetHandle: "write-root-target",
            type: "sessionSpoke",
            className: "write-edge",
            data: {
              toggleBranch: () =>
                toggleBranch(edge.target, branchSiblingIDs.get(edge.target) ?? []),
            },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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
      ...childConnections.map(({ branchID, source, sourceIndex, target }) => ({
        id: `${source}->${target}`,
        source,
        target,
        sourceHandle: `read-source-${sourceIndex}`,
        targetHandle: "subagent-target",
        type: "sessionSpoke",
        className: "subagent-edge",
        data: {
          toggleBranch: () => toggleBranch(branchID, branchSiblingIDs.get(branchID) ?? []),
        },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
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
      focusNodeID: composer.precedingNodeID,
    }
  }, [
    descendants,
    expandedGroups,
    expandedAgents,
    hiddenBranches,
    agentSizes,
    nodeDistance,
    reportAgentSize,
    reportToolGroupSize,
    session.active,
    session.graph.edges,
    session.graph.nodes,
    session.id,
    submitPrompt,
    toggleAgent,
    toggleBranch,
    toggleGroup,
    toolGroupSizes,
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
      toolCallCount += node.toolGroup?.calls.length ?? 0
    }
  }
  return { agentMessageCount: agentMessageIDs.size, toolCallCount }
}

export function SessionPane({
  session,
  descendants,
  submitPrompt,
  interruptSession,
}: SessionPaneProps) {
  const sessions = [session, ...descendants]
  const [interrupting, setInterrupting] = useState(false)
  const [interruptError, setInterruptError] = useState<string | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const stopFollowing = useCallback(() => setFollowLatest(false), [])
  const counts = sessionCounts([session])
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
          : "Idle"

  return (
    <section className="session-pane" aria-label={`Session: ${session.title}`}>
      <div className="session-heading">
        <span className={active ? "session-live-dot" : "session-idle-dot"} />
        <strong>{session.title}</strong>
        <span>
          {executionLabel} · {counts.agentMessageCount}{" "}
          {counts.agentMessageCount === 1 ? "agent message" : "agent messages"} ·{" "}
          {counts.toolCallCount} {counts.toolCallCount === 1 ? "tool call" : "tool calls"}
        </span>
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
            className="open-workspace-button"
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
      <ReactFlowProvider>
        <SessionCanvas
          session={session}
          descendants={descendants}
          followLatest={followLatest}
          stopFollowing={stopFollowing}
          submitPrompt={submitPrompt}
          interruptSession={interruptSession}
        />
      </ReactFlowProvider>
    </section>
  )
}
