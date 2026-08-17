import { DateTime, Schema } from "effect"
import { Location, Project, Session } from "@opencode-ai/client/effect"
import type { ProjectDetails, ProjectSession, ProjectUpdate } from "../../../shared/project"
import type { ProjectView, SessionView } from "../services/OpenCodeGateway"
import { buildSessionGraph } from "./sessionGraph"
import type { SemanticGraph } from "./graph"
import { recordStartupMeasure } from "../startupTiming"
import { createSessionSummaries } from "../../../shared/domain/projectCatalog"
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
        readonly snapshot: ProjectView
        readonly error: undefined
      }
    | {
        readonly status: "error"
        readonly snapshot: ProjectView | undefined
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
  const pendingTexts = value.pendingPrompts.map((prompt) => prompt.text)
  const reconciled = reconcileOptimisticPrompts(optimisticPrompts, value.messages).filter(
    (prompt) => {
      const index = pendingTexts.indexOf(prompt.text)
      if (index === -1) return true
      pendingTexts.splice(index, 1)
      return false
    },
  )
  const view = {
    id: Schema.decodeUnknownSync(Session.ID)(value.id),
    ...(value.parentID === undefined
      ? {}
      : { parentID: Schema.decodeUnknownSync(Session.ID)(value.parentID) }),
    ...(value.location === undefined ? {} : { location: value.location }),
    created: value.created,
    title: value.title,
    active: value.active,
    execution: value.execution,
    questions: value.questions,
    pendingPrompts: value.pendingPrompts,
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

function sessionSummaries(
  sessions: ReadonlyArray<Session.Info>,
  activeSessionIDs: ReadonlyArray<Session.ID>,
) {
  const active = new Set(activeSessionIDs)
  return createSessionSummaries(
    sessions.map((session) => ({
      id: session.id,
      parentID: session.parentID,
      created: DateTime.toEpochMillis(session.time.created),
      title: session.title ?? "Untitled session",
    })),
    active,
  ).map((session) => ({
    id: Schema.decodeUnknownSync(Session.ID)(session.id),
    created: session.created,
    title: session.title,
    active: session.active,
  }))
}

export function openProjectState(
  current: OpenLocationState,
  project: ProjectDetails,
  projectID: Project.ID,
  sessions: ReadonlyArray<Session.Info>,
  activeSessionIDs: ReadonlyArray<Session.ID>,
): OpenLocationState {
  return {
    ...current,
    projectID,
    status: "ready",
    snapshot: {
      project: { ...project, id: projectID },
      location: current.location,
      sessions: current.snapshot?.sessions ?? [],
      recentSessions: sessionSummaries(sessions, activeSessionIDs),
    },
    error: undefined,
  }
}

export function applyProjectUpdate(
  projectID: Project.ID,
  current: OpenLocationState,
  update: ProjectUpdate,
): OpenLocationState {
  if (update._tag === "Sessions") {
    if (current.snapshot === undefined || update.projectID !== projectID) return current
    return {
      ...current,
      snapshot: {
        ...current.snapshot,
        recentSessions: sessionSummaries(update.sessions, update.activeSessionIDs),
      },
    }
  }
  if (current.snapshot === undefined || update.projectID !== projectID) return current
  if (update._tag === "Info") {
    if (update.session.parentID != null) return current
    const summary = {
      id: update.session.id,
      created: DateTime.toEpochMillis(update.session.time.created),
      title: update.session.title ?? "Untitled session",
      active: update.active,
    }
    return {
      ...current,
      snapshot: {
        ...current.snapshot,
        recentSessions: [
          summary,
          ...current.snapshot.recentSessions.filter((item) => item.id !== summary.id),
        ].toSorted((left, right) => right.created - left.created),
      },
    }
  }
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
