import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { GraphToolCall } from "../domain/graph"
import { groupToolCalls } from "./toolCallGroups"

function call(id: string, messageID: string, name: string, detail: string): GraphToolCall {
  return {
    id,
    name,
    input: {},
    detail,
    status: "completed",
    artifacts: [],
    provenance: {
      source: "explicit",
      messageIDs: [messageID],
      contentIndexes: [],
      toolCallIDs: [id],
    },
    time: { created: 1 },
  }
}

it.effect("groups matching tools within a message without crossing message boundaries", () =>
  Effect.sync(() => {
    expect(
      groupToolCalls([
        call("read-1", "message-1", "read", "one.ts"),
        call("grep-1", "message-1", "grep", "Layer"),
        call("read-2", "message-1", "read", "two.ts"),
        call("read-3", "message-2", "read", "three.ts"),
      ]),
    ).toMatchObject([
      { name: "read", detail: "one.ts two.ts" },
      { name: "grep", detail: "Layer" },
      { name: "read", detail: "three.ts" },
    ])
  }),
)
