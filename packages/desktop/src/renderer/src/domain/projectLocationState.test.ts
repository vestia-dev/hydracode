import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  AbsolutePath,
  Location,
  Project,
  Session,
  SessionMessage,
} from "@opencode-ai/client/effect"
import type { OpenLocationState } from "./projectLocationState"
import type { SemanticGraph, SemanticGraphNode } from "./graph"
import { createSessionView, openProjectState, preserveCompletedGraph } from "./projectLocationState"

const projectA = Schema.decodeUnknownSync(Project.ID)("project-a")
const projectB = Schema.decodeUnknownSync(Project.ID)("project-b")
const sessionA = Schema.decodeUnknownSync(Session.ID)("session-a")
const location = Location.Ref.make({ directory: AbsolutePath.make("/tmp/project-a") })
const provenance = {
  source: "explicit" as const,
  messageIDs: [],
  contentIndexes: [],
  toolCallIDs: [],
}

function graphNode(id: string, status: SemanticGraphNode["status"]): SemanticGraphNode {
  return {
    id,
    status,
    kind: "round",
    title: id,
    detail: id,
    artifacts: [],
    provenance,
    agentRunID: id,
    round: { history: [] },
  }
}

function graph(nodes: ReadonlyArray<SemanticGraphNode>): SemanticGraph {
  return { nodes, edges: [], completedSubagentSessionIDs: [] }
}

function opening(projectID: Project.ID): OpenLocationState {
  return {
    locationKey: `/code/${projectID}\u0000`,
    projectID,
    location,
    status: "opening",
    snapshot: undefined,
    error: undefined,
    promptRetry: null,
    landingError: null,
  }
}

describe("openProjectState", () => {
  it("opens only the owning location state", () => {
    const state = opening(projectA)
    const next = openProjectState(
      state,
      { id: projectA, canonical: AbsolutePath.make("/tmp/project-a") },
      projectB,
      [],
      [],
    )

    expect(next.projectID).toBe(projectB)
    expect(next.snapshot?.project.id).toBe(projectB)
  })

  it("projects root metadata into recent sessions", () => {
    const info = Schema.decodeUnknownSync(Session.Info)({
      id: sessionA,
      projectID: "project-a",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      title: "New session",
      location: { directory: "/tmp/project-a" },
    })

    const updated = openProjectState(
      opening(projectA),
      { id: projectA, canonical: AbsolutePath.make("/tmp/project-a") },
      projectA,
      [info],
      [sessionA],
    )

    expect(updated.snapshot?.recentSessions).toMatchObject([
      { id: "session-a", title: "New session", active: true },
    ])
  })
})

it("reconciles an optimistic prompt when OpenCode admits it to the inbox", () => {
  const info = Schema.decodeUnknownSync(Session.Info)({
    id: sessionA,
    projectID: projectA,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: "Session",
    location,
  })
  const view = createSessionView(
    info,
    {
      sessionID: sessionA,
      execution: { _tag: "Running" },
      messages: [],
      questions: [],
      pending: new Map([
        [
          Schema.decodeUnknownSync(SessionMessage.ID)("msg_pending"),
          { type: "user", payload: { text: "Queue this" }, delivery: "queue" },
        ],
      ]),
    },
    true,
    undefined,
    [
      {
        id: "optimistic-prompt:1",
        text: "Queue this",
        created: 1,
        baselineMessageIDs: [],
      },
    ],
  )

  expect(view.optimisticPrompts).toEqual([])
  expect(view.pendingPrompts).toMatchObject([{ text: "Queue this", delivery: "queue" }])
})

describe("preserveCompletedGraph", () => {
  it("reuses completed history while replacing the active tail", () => {
    const completed = graphNode("completed", "completed")
    const running = graphNode("running", "running")
    const next = preserveCompletedGraph(
      graph([graphNode("completed", "completed"), graphNode("running", "completed")]),
      graph([completed, running]),
    )

    expect(next.nodes[0]).toBe(completed)
    expect(next.nodes[1]).not.toBe(running)
    expect(next.nodes[1]?.status).toBe("completed")
  })
})
