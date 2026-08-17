import { Session, SessionMessage } from "@opencode-ai/client/effect"
import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { listAllSessionMessages } from "./sessionMessages"

const sessionID = Session.ID.descending("session")
const message = (id: string) =>
  Schema.decodeUnknownSync(SessionMessage.Info)({
    type: "agent-switched",
    id,
    agent: "build",
    time: { created: 1 },
  })

it.effect("loads every message page in ascending order and deduplicates messages", () =>
  Effect.gen(function* () {
    const inputs: Array<unknown> = []
    const pages = [
      { data: [message("msg_1"), message("msg_2")], cursor: { next: "page-2" } },
      { data: [message("msg_2"), message("msg_3")], cursor: {} },
    ]
    const messages = yield* listAllSessionMessages((input) => {
      inputs.push(input)
      return Effect.succeed(pages.shift()!)
    }, sessionID)

    expect(inputs).toEqual([
      { sessionID, order: "asc" },
      { sessionID, cursor: "page-2" },
    ])
    expect(messages.map((item) => item.id)).toEqual(["msg_1", "msg_2", "msg_3"])
  }),
)

it.effect("stops when the server repeats a cursor", () =>
  Effect.gen(function* () {
    let calls = 0
    const messages = yield* listAllSessionMessages(() => {
      calls += 1
      return Effect.succeed({ data: [message(`msg_${calls}`)], cursor: { next: "same" } })
    }, sessionID)

    expect(calls).toBe(2)
    expect(messages).toHaveLength(2)
  }),
)
