import { Session, type SessionMessage } from "@opencode-ai/client/effect"
import { expect, it } from "@effect/vitest"
import { Brand, DateTime, Effect } from "effect"
import {
  createProvisionalSessionID,
  projectOptimisticPrompts,
  reconcileOptimisticPrompts,
} from "./optimisticPrompts"

const messageID = Brand.nominal<SessionMessage.ID>()
const prompt = {
  id: "optimistic:1",
  text: "Add the first round immediately",
  created: 2_000,
  baselineMessageIDs: ["existing"],
}

it.effect("creates provisional IDs accepted by the OpenCode session schema", () =>
  Effect.sync(() => {
    const id = createProvisionalSessionID()
    expect(id.startsWith("ses")).toBe(true)
    expect(Session.ID.make(id)).toBe(id)
  }),
)

it.effect("appends an optimistic prompt as the next timeline round", () =>
  Effect.sync(() => {
    const graph = projectOptimisticPrompts(
      {
        nodes: [
          {
            id: "round:existing",
            kind: "round",
            title: "Round",
            detail: "Complete",
            status: "completed",
            artifacts: [],
            provenance: {
              source: "derived",
              messageIDs: ["existing"],
              contentIndexes: [],
              toolCallIDs: [],
            },
            agentRunID: "round:existing",
            round: { history: [] },
          },
        ],
        edges: [],
      },
      [prompt],
    )

    expect(graph.nodes.at(-1)).toMatchObject({
      id: "optimistic:1",
      kind: "round",
      detail: "Waiting for the agent",
      round: { input: { text: "Add the first round immediately" } },
    })
    expect(graph.edges).toEqual([
      {
        id: "round:existing->optimistic:1",
        source: "round:existing",
        target: "optimistic:1",
        kind: "timeline",
      },
    ])
  }),
)

it.effect("keeps a prompt pending until a new matching authoritative input arrives", () =>
  Effect.sync(() => {
    const existing = {
      id: messageID("existing"),
      type: "user" as const,
      text: prompt.text,
      time: { created: DateTime.makeUnsafe(1_000) },
    }
    expect(reconcileOptimisticPrompts([prompt], [existing])).toEqual([prompt])
    expect(
      reconcileOptimisticPrompts(
        [prompt],
        [
          existing,
          {
            ...existing,
            id: messageID("authoritative-new"),
            time: { created: DateTime.makeUnsafe(2_100) },
          },
        ],
      ),
    ).toEqual([])
  }),
)
