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
import { createSessionView, openProjectState } from "./projectLocationState"

const projectA = Schema.decodeUnknownSync(Project.ID)("project-a")
const projectB = Schema.decodeUnknownSync(Project.ID)("project-b")
const sessionA = Schema.decodeUnknownSync(Session.ID)("session-a")
const location = Location.Ref.make({ directory: AbsolutePath.make("/tmp/project-a") })

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

function assistantToolMessage(id: string, callID: string, created: number) {
  return Schema.decodeUnknownSync(SessionMessage.Info)({
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "openai", id: "gpt-5" },
    finish: "tool-calls",
    content: [
      {
        type: "tool",
        id: callID,
        name: "read",
        state: {
          status: "completed",
          input: {},
          metadata: {},
          content: [{ type: "text", text: "ok" }],
        },
        time: { created, ran: created + 1, completed: created + 2 },
      },
    ],
    time: { created, completed: created + 2 },
  })
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

it("rebuilds a completed round when later tool calls join it", () => {
  const info = Schema.decodeUnknownSync(Session.Info)({
    id: sessionA,
    projectID: projectA,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: "Session",
    location,
  })
  const user = Schema.decodeUnknownSync(SessionMessage.Info)({
    id: "msg_user",
    type: "user",
    text: "Inspect the app",
    time: { created: 1 },
  })
  const state = {
    sessionID: sessionA,
    execution: { _tag: "Idle" as const },
    messages: [user, assistantToolMessage("msg_assistant_1", "call_1", 2)],
    questions: [],
    pending: new Map(),
  }
  const previous = createSessionView(info, state, false)
  const current = createSessionView(
    info,
    {
      ...state,
      messages: [...state.messages, assistantToolMessage("msg_assistant_2", "call_2", 5)],
    },
    false,
    previous,
  )
  const tools = current.graph.nodes.find((node) => node.kind === "round-tools")

  expect(tools?.kind === "round-tools" ? tools.roundTools.calls : []).toHaveLength(2)
})
