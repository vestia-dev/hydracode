import { Session, type SessionMessage } from "@opencode-ai/client/effect"
import { expect, it } from "@effect/vitest"
import { Brand, DateTime, Effect } from "effect"
import {
  createProvisionalSessionID,
  applyOptimisticPrompts,
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
    const graph = applyOptimisticPrompts(
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
        completedSubagentSessionIDs: [],
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

it.effect("settles identical prompts one authoritative message at a time across replays", () =>
  Effect.sync(() => {
    const first = { ...prompt, id: "optimistic:1" }
    const second = { ...prompt, id: "optimistic:2" }
    const authoritativeFirst = {
      id: messageID("authoritative:first"),
      type: "user" as const,
      text: prompt.text,
      time: { created: DateTime.makeUnsafe(2_100) },
    }

    const afterFirstUpdate = reconcileOptimisticPrompts([first, second], [authoritativeFirst])
    expect(afterFirstUpdate).toEqual([
      {
        ...second,
        baselineMessageIDs: ["existing", "authoritative:first"],
      },
    ])

    expect(reconcileOptimisticPrompts(afterFirstUpdate, [authoritativeFirst])).toEqual(
      afterFirstUpdate,
    )

    const authoritativeSecond = {
      ...authoritativeFirst,
      id: messageID("authoritative:second"),
      time: { created: DateTime.makeUnsafe(2_200) },
    }
    expect(
      reconcileOptimisticPrompts(afterFirstUpdate, [authoritativeFirst, authoritativeSecond]),
    ).toEqual([])
  }),
)

it.effect("records non-matching messages without settling a pending prompt", () =>
  Effect.sync(() => {
    const unrelated = {
      id: messageID("authoritative:unrelated"),
      type: "user" as const,
      text: "A different prompt",
      time: { created: DateTime.makeUnsafe(2_100) },
    }

    expect(reconcileOptimisticPrompts([prompt], [unrelated])).toEqual([
      {
        ...prompt,
        baselineMessageIDs: ["existing", "authoritative:unrelated"],
      },
    ])
  }),
)
