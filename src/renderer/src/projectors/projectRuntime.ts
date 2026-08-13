import { Schema } from "effect"
import { Project, Session } from "@opencode-ai/client/effect"
import type { ProjectSession, ProjectSnapshot, ProjectUpdate } from "../../../shared/project"
import type { OpenProjectRuntime } from "../hooks/useProjectController"
import type {
  ProjectSnapshot as ProjectViewSnapshot,
  SessionView,
} from "../services/OpenCodeGateway"
import { projectMessages } from "./sessionGraph"
import {
  projectOptimisticPrompts,
  reconcileOptimisticPrompts,
  type OptimisticPrompt,
} from "./optimisticPrompts"

export function projectSessionView(
  value: ProjectSession,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt> = [],
): SessionView {
  const authoritativeGraph = projectMessages(value.messages)
  const reconciled = reconcileOptimisticPrompts(optimisticPrompts, value.messages)
  return {
    id: Schema.decodeUnknownSync(Session.ID)(value.id),
    ...(value.parentID === undefined
      ? {}
      : { parentID: Schema.decodeUnknownSync(Session.ID)(value.parentID) }),
    created: value.created,
    title: value.title,
    active: value.active,
    synchronized: value.synchronized,
    execution: value.execution,
    questions: value.questions,
    provisional: false,
    authoritativeGraph,
    optimisticPrompts: reconciled,
    graph: projectOptimisticPrompts(authoritativeGraph, reconciled),
  }
}

function projectSnapshot(
  value: ProjectSnapshot,
  previous?: ProjectViewSnapshot,
): ProjectViewSnapshot {
  const projected = value.sessions.map((session) => {
    const current = previous?.sessions.find((item) => item.id === session.id)
    return projectSessionView(session, current?.optimisticPrompts)
  })
  const provisional = previous?.sessions.filter(
    (session) => session.provisional && !projected.some((item) => item.id === session.id),
  )
  return {
    project: value.project,
    location: value.location,
    sessions: [...projected, ...(provisional ?? [])],
    recentSessions: value.recentSessions.map((session) => ({
      ...session,
      id: Schema.decodeUnknownSync(Session.ID)(session.id),
    })),
  }
}

export function applyProjectUpdate(
  projectID: Project.ID,
  current: OpenProjectRuntime,
  update: ProjectUpdate,
): OpenProjectRuntime {
  if (update._tag === "Snapshot") {
    if (update.snapshot.project.id !== projectID) return current
    return {
      ...current,
      status: "ready",
      snapshot: projectSnapshot(update.snapshot, current.snapshot),
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
        projectSessionView(update.session, existing?.optimisticPrompts),
      ],
    },
  }
}
