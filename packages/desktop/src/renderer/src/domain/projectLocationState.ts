import { DateTime, Schema } from "effect"
import { Location, Project, Session } from "@opencode-ai/client/effect"
import type { ProjectDetails } from "../../../shared/project"
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
import type { SessionLogState } from "../../../shared/domain/sessionLog"
import { SessionMessage } from "@opencode-ai/schema/session-message"

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
  info: Session.Info,
  state: SessionLogState,
  active: boolean,
  previous?: SessionView,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt> = previous?.optimisticPrompts ?? [],
): SessionView {
  const started = performance.now()
  const authoritativeGraph = preserveCompletedGraph(
    buildSessionGraph(state.messages, active),
    previous?.authoritativeGraph,
  )
  const pendingPrompts = Array.from(state.pending.entries()).flatMap(([id, item]) =>
    item.type === "user"
      ? [
          {
            id: Schema.decodeUnknownSync(SessionMessage.ID)(id),
            text: item.payload.text,
            delivery: item.delivery,
          },
        ]
      : [],
  )
  const pendingTexts = pendingPrompts.map((prompt) => prompt.text)
  const reconciled = reconcileOptimisticPrompts(optimisticPrompts, state.messages).filter(
    (prompt) => {
      const index = pendingTexts.indexOf(prompt.text)
      if (index === -1) return true
      pendingTexts.splice(index, 1)
      return false
    },
  )
  const view: SessionView = {
    id: info.id,
    ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
    location: info.location,
    created: DateTime.toEpochMillis(info.time.created),
    title: info.title ?? "Untitled session",
    active,
    execution: state.execution,
    questions: state.questions,
    pendingPrompts,
    provisional: false,
    authoritativeGraph,
    optimisticPrompts: reconciled,
    graph: applyOptimisticPrompts(authoritativeGraph, reconciled),
  }
  recordStartupMeasure("session-graph-build", started, {
    messages: state.messages.length,
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
      recentSessions: sessionSummaries(sessions, activeSessionIDs),
    },
    error: undefined,
  }
}
