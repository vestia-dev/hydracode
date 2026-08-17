import type { OpenCodeClient } from "@opencode-ai/client/effect"
import { Effect } from "effect"

type MessageList = OpenCodeClient["message"]["list"]

export function listAllSessionMessages(
  list: MessageList,
  sessionID: Parameters<MessageList>[0]["sessionID"],
) {
  return Effect.gen(function* () {
    const messages = new Map<string, Effect.Success<ReturnType<MessageList>>["data"][number]>()
    const cursors = new Set<string>()
    let cursor: string | undefined

    while (true) {
      const page = yield* list(
        cursor === undefined ? { sessionID, order: "asc" } : { sessionID, cursor },
      )
      for (const message of page.data) messages.set(message.id, message)
      const next = page.cursor.next
      if (next === undefined || cursors.has(next)) break
      cursors.add(next)
      cursor = next
    }

    return Array.from(messages.values())
  })
}
