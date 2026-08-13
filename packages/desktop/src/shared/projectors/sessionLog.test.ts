import { expect, it } from "@effect/vitest"
import type { OpenCodeEvent, SessionMessage } from "@opencode-ai/client/effect"
import { Effect } from "effect"
import {
  createSessionLogState,
  hydrateSessionLogState,
  questionFormAnswer,
  reduceSessionLog,
} from "./sessionLog"

function asEvent(input: object): OpenCodeEvent {
  // Fixtures intentionally bridge the SDK's branded decoded event type.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return input as unknown as OpenCodeEvent
}

function durable(type: string, seq: number, data: object, id = `evt_${seq}`): OpenCodeEvent {
  return asEvent({
    id,
    created: seq * 1000,
    type,
    durable: { aggregateID: "session-1", seq, version: 1 },
    data,
  })
}

it.effect("tracks durable sequence, ignores duplicates, and reports gaps without throwing", () =>
  Effect.sync(() => {
    const initial = createSessionLogState("session-1")
    const first = reduceSessionLog(
      initial,
      durable("session.execution.started", 1, { sessionID: "session-1" }),
    )
    const duplicate = reduceSessionLog(
      first.state,
      durable("session.execution.started", 1, { sessionID: "session-1" }),
    )
    const gap = reduceSessionLog(
      first.state,
      durable("session.execution.started", 3, { sessionID: "session-1" }),
    )

    expect(first.status).toBe("applied")
    expect(first.state.durableSeq).toBe(1)
    expect(first.state.execution).toEqual({ _tag: "Running" })
    expect(duplicate).toMatchObject({ status: "duplicate", seq: 1 })
    expect(gap).toMatchObject({ status: "gap", expected: 2, received: 3 })
    expect(gap.state).toEqual(first.state)
  }),
)

it.effect("uses log.synced as the replay watermark", () =>
  Effect.sync(() => {
    const state = createSessionLogState("session-1")
    const synced = reduceSessionLog(
      state,
      asEvent({ type: "log.synced", aggregateID: "session-1", seq: 7 }),
    )
    const next = reduceSessionLog(
      synced.state,
      durable("session.execution.started", 8, { sessionID: "session-1" }),
    )

    expect(synced.state.durableSeq).toBe(7)
    expect(synced.state.synchronized).toBe(true)
    expect(next.status).toBe("applied")
    expect(
      reduceSessionLog(
        next.state,
        asEvent({ type: "log.synced", aggregateID: "session-1", seq: 7 }),
      ).status,
    ).toBe("applied")
  }),
)

it.effect("advances the durable cursor when promoted input needs targeted hydration", () =>
  Effect.sync(() => {
    const reduction = reduceSessionLog(
      createSessionLogState("session-1"),
      durable("session.input.promoted", 1, {
        sessionID: "session-1",
        inputID: "input-1",
      }),
    )

    expect(reduction).toMatchObject({
      status: "missing-input",
      inputID: "input-1",
      state: { durableSeq: 1 },
    })
  }),
)

it.effect("hydrates existing context at the captured durable watermark", () =>
  Effect.sync(() => {
    const existing = { id: "message-1", type: "system", text: "existing", time: { created: 1000 } }
    // Fixtures intentionally bridge the SDK's branded decoded message type.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const message = existing as unknown as SessionMessage.Info
    const state = hydrateSessionLogState("session-1", [message], 307)

    expect(state).toMatchObject({
      durableSeq: 307,
      synchronized: true,
      messages: [{ id: "message-1", text: "existing" }],
    })
  }),
)

it.effect("projects pending question requests until they are replied to or rejected", () =>
  Effect.sync(() => {
    const asked = asEvent({
      id: "evt-question-1",
      created: 1000,
      type: "question.asked",
      data: {
        id: "que_1",
        sessionID: "session-1",
        questions: [
          {
            header: "Approach",
            question: "Which approach should be used?",
            options: [{ label: "Simple", description: "Use the smallest change" }],
          },
        ],
      },
    })
    const projected = reduceSessionLog(createSessionLogState("session-1"), asked)

    expect(projected.state.questions).toMatchObject([
      { id: "que_1", questions: [{ header: "Approach" }] },
    ])

    const replied = reduceSessionLog(
      projected.state,
      asEvent({
        id: "evt-question-2",
        created: 2000,
        type: "question.replied",
        data: { sessionID: "session-1", requestID: "que_1", answers: [["Simple"]] },
      }),
    )
    expect(replied.state.questions).toEqual([])

    const restored = reduceSessionLog(replied.state, asked)
    const rejected = reduceSessionLog(
      restored.state,
      asEvent({
        id: "evt-question-3",
        created: 3000,
        type: "question.rejected",
        data: { sessionID: "session-1", requestID: "que_1" },
      }),
    )
    expect(rejected.state.questions).toEqual([])
  }),
)

it.effect("projects question forms and maps selected labels back to form values", () =>
  Effect.sync(() => {
    const created = asEvent({
      id: "evt-form-1",
      created: 1000,
      type: "form.created",
      data: {
        form: {
          id: "frm_1",
          sessionID: "session-1",
          title: "Questions",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              title: "Season",
              description: "Which season?",
              type: "string",
              options: [{ value: "autumn", label: "Autumn", description: "Cool weather" }],
              custom: true,
            },
          ],
        },
      },
    })
    if (created.type !== "form.created") throw new Error("Expected a form.created fixture")
    const projected = reduceSessionLog(createSessionLogState("session-1"), created)

    expect(projected.state.questions).toMatchObject([
      {
        id: "que_frm_1",
        questions: [{ header: "Season", question: "Which season?" }],
      },
    ])
    expect(questionFormAnswer(created.data.form, [["Autumn"]])).toEqual({ q0: "autumn" })

    const replied = reduceSessionLog(
      projected.state,
      asEvent({
        id: "evt-form-2",
        created: 2000,
        type: "form.replied",
        data: { id: "frm_1", sessionID: "session-1", answer: { q0: "autumn" } },
      }),
    )
    expect(replied.state.questions).toEqual([])
  }),
)

it.effect("ignores question requests for another session", () =>
  Effect.sync(() => {
    const reduction = reduceSessionLog(
      createSessionLogState("session-1"),
      asEvent({
        id: "evt-question-other",
        created: 1000,
        type: "question.asked",
        data: {
          id: "que_other",
          sessionID: "session-2",
          questions: [],
        },
      }),
    )

    expect(reduction.status).toBe("ignored")
    expect(reduction.state.questions).toEqual([])
  }),
)

it.effect(
  "projects input, assistant text and reasoning, tool lifecycle, retry, and compaction",
  () =>
    Effect.sync(() => {
      let state = createSessionLogState("session-1")
      const events = [
        durable("session.input.admitted", 1, {
          sessionID: "session-1",
          inputID: "input-1",
          input: { type: "user", data: { text: "hello" }, delivery: "queue" },
        }),
        durable("session.input.promoted", 2, { sessionID: "session-1", inputID: "input-1" }),
        durable("session.step.started", 3, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          agent: "build",
          model: { id: "model", providerID: "provider" },
        }),
        durable("session.text.started", 4, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          ordinal: 0,
        }),
        asEvent({
          id: "evt-5",
          created: 5000,
          type: "session.text.delta",
          data: {
            sessionID: "session-1",
            assistantMessageID: "assistant-1",
            ordinal: 0,
            delta: "hi",
          },
        }),
        durable("session.reasoning.started", 5, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          ordinal: 0,
        }),
        asEvent({
          id: "evt-7",
          created: 7000,
          type: "session.reasoning.delta",
          data: {
            sessionID: "session-1",
            assistantMessageID: "assistant-1",
            ordinal: 0,
            delta: "why",
          },
        }),
        durable("session.tool.input.started", 6, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          id: "call-1",
          name: "read",
        }),
        asEvent({
          id: "evt-8",
          created: 8000,
          type: "session.tool.input.delta",
          data: {
            sessionID: "session-1",
            assistantMessageID: "assistant-1",
            id: "call-1",
            delta: '{"path":"README.md"}',
          },
        }),
        durable("session.tool.called", 7, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          id: "call-1",
          input: { path: "README.md" },
          executed: true,
        }),
        durable("session.tool.success", 8, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          id: "call-1",
          input: { path: "README.md" },
          executed: true,
          content: [{ type: "text", text: "ok" }],
        }),
        durable("session.retry.scheduled", 9, {
          sessionID: "session-1",
          assistantMessageID: "assistant-1",
          attempt: 1,
          at: 9000,
          error: { type: "retry", message: "again" },
        }),
        durable("session.compaction.started", 10, {
          sessionID: "session-1",
          reason: "auto",
          recent: "recent",
        }),
        asEvent({
          id: "evt-11",
          created: 11000,
          type: "session.compaction.delta",
          data: { sessionID: "session-1", text: "summary" },
        }),
      ]
      for (const item of events) {
        const reduction = reduceSessionLog(state, item)
        expect(reduction.status).not.toBe("gap")
        if (reduction.status === "applied") state = reduction.state
      }

      expect(state.messages.map((item) => item.type)).toEqual(["user", "assistant", "compaction"])
      const assistant = state.messages[1]
      expect(assistant).toMatchObject({ type: "assistant", retry: { attempt: 1 } })
      expect(assistant?.type === "assistant" ? assistant.content : []).toMatchObject([
        { type: "text", text: "hi" },
        { type: "reasoning", text: "why" },
        { type: "tool", id: "call-1", state: { status: "completed" } },
      ])
      expect(state.messages[2]).toMatchObject({ type: "compaction", summary: "summary" })
    }),
)
