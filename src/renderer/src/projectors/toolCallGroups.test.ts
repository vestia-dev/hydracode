import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { GraphNodeStatus, GraphToolCall } from "../domain/graph"
import { groupToolCalls, toolGroupExpansionKey, visibleToolRowCount } from "./toolCallGroups"

function call(id: string, name: string, status: GraphNodeStatus = "completed"): GraphToolCall {
  return {
    id,
    name,
    input: {},
    detail: `${name} input`,
    status,
    artifacts: [],
    provenance: {
      source: "explicit",
      messageIDs: ["message"],
      contentIndexes: [],
      toolCallIDs: [id],
    },
    time: { created: 1 },
  }
}

it.effect("groups calls by tool name in first-seen order", () =>
  Effect.sync(() => {
    const groups = groupToolCalls([
      call("glob-1", "glob"),
      call("read-1", "read"),
      call("glob-2", "glob"),
      call("shell-1", "shell"),
      call("read-2", "read"),
    ])

    expect(groups.map((group) => [group.name, group.calls.length])).toEqual([
      ["glob", 2],
      ["read", 2],
      ["shell", 1],
    ])
  }),
)

it.effect("uses the most important status across grouped calls", () =>
  Effect.sync(() => {
    expect(
      groupToolCalls([call("read-1", "read", "completed"), call("read-2", "read", "running")])[0]
        ?.status,
    ).toBe("running")
    expect(
      groupToolCalls([call("read-1", "read", "running"), call("read-2", "read", "error")])[0]
        ?.status,
    ).toBe("error")
  }),
)

it.effect("counts underlying calls only for expanded tool groups", () =>
  Effect.sync(() => {
    const calls = [call("read-1", "read"), call("read-2", "read"), call("shell-1", "shell")]
    expect(visibleToolRowCount("group", calls, new Set())).toBe(2)
    expect(
      visibleToolRowCount("group", calls, new Set([toolGroupExpansionKey("group", "read")])),
    ).toBe(4)
  }),
)
