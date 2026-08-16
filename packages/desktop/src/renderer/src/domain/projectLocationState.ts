import { Schema } from "effect"
import { Location, Project, Session } from "@opencode-ai/client/effect"
import type { ProjectSession, ProjectSnapshot, ProjectUpdate } from "../../../shared/project"
import type {
  ProjectSnapshot as ProjectViewSnapshot,
  SessionView,
} from "../services/OpenCodeGateway"
import { buildSessionGraph } from "./sessionGraph"
import type { SemanticGraph } from "./graph"
import { recordStartupMeasure } from "../startupTiming"
import {
  applyOptimisticPrompts,
  reconcileOptimisticPrompts,
  type OptimisticPrompt,
} from "./optimisticPrompts"

export interface PromptRetry {
  readonly sessionID: SessionView["id"]
  readonly text: string
  readonly message: string
}

interface OpenLocationCommon {
  readonly locationKey: string
  readonly projectID: Project.ID
  readonly location: Location.Ref
  readonly promptRetry: PromptRetry | null
  readonly landingError: string | null
  readonly requestedSessionID?: SessionView["id"] | undefined
}

export type OpenLocationState = OpenLocationCommon &
  (
    | {
        readonly status: "opening"
        readonly snapshot: undefined
        readonly error: undefined
      }
    | {
        readonly status: "ready"
        readonly snapshot: ProjectViewSnapshot
        readonly error: undefined
      }
    | {
        readonly status: "error"
        readonly snapshot: ProjectViewSnapshot | undefined
        readonly error: string
      }
  )

export function createSessionView(
  value: ProjectSession,
  previous?: SessionView,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt> = previous?.optimisticPrompts ?? [],
): SessionView {
  const started = performance.now()
  const authoritativeGraph = preserveCompletedGraph(
    buildSessionGraph(value.messages, value.active),
    previous?.authoritativeGraph,
  )
  const reconciled = reconcileOptimisticPrompts(optimisticPrompts, value.messages)
  const view = {
    id: Schema.decodeUnknownSync(Session.ID)(value.id),
    ...(value.parentID === undefined
      ? {}
      : { parentID: Schema.decodeUnknownSync(Session.ID)(value.parentID) }),
    ...(value.location === undefined ? {} : { location: value.location }),
    created: value.created,
    title: value.title,
    active: value.active,
    synchronized: value.synchronized,
    execution: value.execution,
    questions: value.questions,
    provisional: false,
    authoritativeGraph,
    optimisticPrompts: reconciled,
    graph: applyOptimisticPrompts(authoritativeGraph, reconciled),
  }
  recordStartupMeasure("session-graph-build", started, {
    messages: value.messages.length,
    nodes: view.graph.nodes.length,
    edges: view.graph.edges.length,
  })
  return view
}

export function preserveCompletedGraph(current: SemanticGraph, previous?: SemanticGraph) {
  if (previous === undefined) return current
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]))
  const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]))
  return {
    ...current,
    nodes: current.nodes.map((node) => {
      const existing = previousNodes.get(node.id)
      return existing?.status === "completed" || existing?.status === "error" ? existing : node
    }),
    edges: current.edges.map((edge) => previousEdges.get(edge.id) ?? edge),
  }
}

function createProjectViewState(
  value: ProjectSnapshot,
  previous?: ProjectViewSnapshot,
): ProjectViewSnapshot {
  const sessions = value.sessions.map((session) => {
    const current = previous?.sessions.find((item) => item.id === session.id)
    return createSessionView(session, current)
  })
  const provisional = previous?.sessions.filter(
    (session) => session.provisional && !sessions.some((item) => item.id === session.id),
  )
  return {
    project: value.project,
    location: value.location,
    sessions: [...sessions, ...(provisional ?? [])],
    recentSessions: value.recentSessions.map((session) => ({
      ...session,
      id: Schema.decodeUnknownSync(Session.ID)(session.id),
    })),
  }
}

export function applyProjectUpdate(
  projectID: Project.ID,
  current: OpenLocationState,
  update: ProjectUpdate,
): OpenLocationState {
  if (update._tag === "Snapshot") {
    if (update.snapshot.project.id !== projectID) return current
    return {
      ...current,
      status: "ready",
      snapshot: createProjectViewState(update.snapshot, current.snapshot),
      error: undefined,
    }
  }
  if (update._tag === "Error") return { ...current, status: "error", error: update.message }
  if (current.snapshot === undefined || update.projectID !== projectID) return current
  if (update._tag === "Removed") {
    return {
      ...current,
      snapshot: {
        ...current.snapshot,
        sessions: current.snapshot.sessions.filter((item) => item.id !== update.sessionID),
        recentSessions: current.snapshot.recentSessions.filter(
          (item) => item.id !== update.sessionID,
        ),
      },
    }
  }
  const existing = current.snapshot.sessions.find((item) => item.id === update.session.id)
  if (existing === undefined && current.snapshot.sessions.some((item) => item.provisional))
    return current
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      sessions: [
        ...current.snapshot.sessions.filter((item) => item.id !== update.session.id),
        createSessionView(update.session, existing),
      ],
    },
  }
}
