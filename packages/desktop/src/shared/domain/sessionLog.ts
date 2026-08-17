import { SessionMessage } from "@opencode-ai/schema/session-message"
import {
  Form,
  Question,
  Session,
  type EventLog,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { DateTime } from "effect"

type Assistant = Extract<SessionMessage.Info, { type: "assistant" }>
type AssistantContent = Assistant["content"][number]
type Text = Extract<AssistantContent, { type: "text" }>
type Reasoning = Extract<AssistantContent, { type: "reasoning" }>
type Tool = Extract<AssistantContent, { type: "tool" }>
type Compaction = Extract<SessionMessage.Info, { type: "compaction" }>
type InboxItem = Extract<OpenCodeEvent, { type: "session.inbox.enqueued" }>["data"]["item"]

export type SessionLogEvent = OpenCodeEvent | EventLog.Synced

export interface SessionLogState {
  readonly sessionID: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly durableSeq?: number
  readonly execution: SessionExecutionState
  readonly pending: ReadonlyMap<string, InboxItem>
  readonly questions: ReadonlyArray<Question.Request>
}

export type SessionExecutionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running" }
  | {
      readonly _tag: "Retrying"
      readonly attempt: number
      readonly at: number
      readonly message: string
    }
  | { readonly _tag: "Failed"; readonly message: string }

export type SessionLogReduction =
  | {
      readonly status: "applied"
      readonly state: SessionLogState
      readonly touched: ReadonlyArray<string>
    }
  | {
      readonly status: "duplicate"
      readonly state: SessionLogState
      readonly seq: number
    }
  | {
      readonly status: "gap"
      readonly state: SessionLogState
      readonly expected: number
      readonly received: number
    }
  | {
      readonly status: "ignored"
      readonly state: SessionLogState
    }
  | {
      readonly status: "missing-input"
      readonly state: SessionLogState
      readonly inputID: string
    }

export function createSessionLogState(
  sessionID: string,
  messages: ReadonlyArray<SessionMessage.Info> = [],
): SessionLogState {
  return {
    sessionID,
    messages,
    execution: { _tag: "Idle" },
    pending: new Map(),
    questions: [],
  }
}

export function initializeSessionLogState(
  sessionID: string,
  messages: ReadonlyArray<SessionMessage.Info>,
  durableSeq?: number,
  questions: ReadonlyArray<Question.Request> = [],
  pending: ReadonlyMap<string, InboxItem> = new Map(),
): SessionLogState {
  return {
    ...createSessionLogState(sessionID, messages),
    ...(durableSeq === undefined ? {} : { durableSeq }),
    questions: questions.toSorted((left, right) => left.id.localeCompare(right.id)),
    pending,
  }
}

export function questionFromForm(form: Form.Info): Question.Request | undefined {
  if (form.metadata?.["kind"] !== "question") return undefined
  const fields = form.fields.filter(
    (field): field is Form.StringField | Form.MultiselectField =>
      field.type === "string" || field.type === "multiselect",
  )
  if (fields.length === 0) return undefined
  return {
    id: Question.ID.ascending(`que_${form.id}`),
    sessionID: Session.ID.descending(form.sessionID),
    questions: fields.map((field) =>
      Object.assign(
        {
          header: field.title ?? form.title,
          question: field.description ?? field.title ?? form.title,
          options: (field.options ?? []).map((option) => ({
            label: option.label,
            description: option.description ?? "",
          })),
        },
        field.type === "multiselect" ? { multiple: true as const } : {},
        field.custom === undefined ? {} : { custom: field.custom },
      ),
    ),
  }
}

export function questionFormAnswer(
  form: Form.Info,
  answers: ReadonlyArray<Question.Answer>,
): Form.Answer {
  return Object.fromEntries(
    form.fields
      .filter(
        (field): field is Form.StringField | Form.MultiselectField =>
          field.type === "string" || field.type === "multiselect",
      )
      .map((field, index) => {
        const values = (answers[index] ?? []).map(
          (answer) => field.options?.find((option) => option.label === answer)?.value ?? answer,
        )
        return [field.key, field.type === "multiselect" ? values : (values[0] ?? "")]
      }),
  )
}

export function questionFormID(requestID: string): Form.ID | undefined {
  if (!requestID.startsWith("que_frm_")) return undefined
  return Form.ID.create(requestID.slice(4))
}

export function sessionIDFromEvent(event: OpenCodeEvent): string | undefined {
  if (event.type === "form.created") return event.data.form.sessionID
  return "sessionID" in event.data && typeof event.data.sessionID === "string"
    ? event.data.sessionID
    : undefined
}

export function reduceSessionLog(
  state: SessionLogState,
  event: SessionLogEvent,
): SessionLogReduction {
  if (event.type === "log.synced") {
    if (event.aggregateID !== state.sessionID) return { status: "ignored", state }
    if (
      event.seq === undefined ||
      (state.durableSeq !== undefined && event.seq <= state.durableSeq)
    ) {
      return { status: "applied", state, touched: [] }
    }
    return {
      status: "applied",
      state: { ...state, durableSeq: event.seq },
      touched: [],
    }
  }

  if (sessionIDFromEvent(event) !== state.sessionID) return { status: "ignored", state }
  if ("durable" in event && event.durable.aggregateID !== state.sessionID)
    return { status: "ignored", state }

  if ("durable" in event) {
    const seq = event.durable.seq
    const expected = state.durableSeq === undefined ? 1 : state.durableSeq + 1
    if (seq < expected) return { status: "duplicate", state, seq }
    if (seq > expected) return { status: "gap", state, expected, received: seq }
  }

  const applied = applyEvent(state, event)
  if (applied.status === "missing-input") {
    return {
      ...applied,
      state:
        "durable" in event ? { ...applied.state, durableSeq: event.durable.seq } : applied.state,
    }
  }

  return {
    status: "applied",
    state: "durable" in event ? { ...applied.state, durableSeq: event.durable.seq } : applied.state,
    touched: applied.touched,
  }
}

function applyEvent(
  state: SessionLogState,
  event: OpenCodeEvent,
):
  | {
      readonly status: "applied"
      readonly state: SessionLogState
      readonly touched: ReadonlyArray<string>
    }
  | {
      readonly status: "missing-input"
      readonly state: SessionLogState
      readonly inputID: string
    } {
  const result = (
    messages: ReadonlyArray<SessionMessage.Info>,
    touched: ReadonlyArray<string> = [],
    pending: ReadonlyMap<string, InboxItem> = state.pending,
  ) => ({
    status: "applied" as const,
    state: { ...state, messages, pending },
    touched,
  })
  const append = (message: SessionMessage.Info) =>
    result(
      state.messages.some((item) => item.id === message.id)
        ? state.messages
        : [...state.messages, message],
      [message.id],
    )

  switch (event.type) {
    case "form.created": {
      const question = questionFromForm(event.data.form)
      if (question === undefined) return result(state.messages)
      return {
        status: "applied",
        state: {
          ...state,
          questions: [
            ...state.questions.filter((request) => request.id !== question.id),
            question,
          ].toSorted((left, right) => left.id.localeCompare(right.id)),
        },
        touched: [],
      }
    }
    case "form.replied":
    case "form.cancelled": {
      const requestID = Question.ID.ascending(`que_${event.data.id}`)
      return {
        status: "applied",
        state: {
          ...state,
          questions: state.questions.filter((request) => request.id !== requestID),
        },
        touched: [],
      }
    }
    case "question.asked":
      return {
        status: "applied",
        state: {
          ...state,
          questions: [
            ...state.questions.filter((request) => request.id !== event.data.id),
            event.data,
          ].toSorted((left, right) => left.id.localeCompare(right.id)),
        },
        touched: [],
      }
    case "question.replied":
    case "question.rejected":
      return {
        status: "applied",
        state: {
          ...state,
          questions: state.questions.filter((request) => request.id !== event.data.requestID),
        },
        touched: [],
      }
    case "session.inbox.enqueued": {
      const pending = new Map(state.pending)
      pending.set(event.data.inboxID, event.data.item)
      return result(state.messages, [], pending)
    }
    case "session.inbox.cancelled": {
      if (!state.pending.has(event.data.inboxID)) return result(state.messages)
      const pending = new Map(state.pending)
      pending.delete(event.data.inboxID)
      return result(state.messages, [], pending)
    }
    case "session.inbox.delivery.changed": {
      const input = state.pending.get(event.data.inboxID)
      if (input === undefined) return result(state.messages)
      const pending = new Map(state.pending)
      pending.set(event.data.inboxID, { ...input, delivery: event.data.delivery })
      return result(state.messages, [], pending)
    }
    case "session.inbox.delivered": {
      const input = state.pending.get(event.data.inboxID)
      if (input === undefined)
        return { status: "missing-input", state, inputID: event.data.inboxID }
      const pending = new Map(state.pending)
      pending.delete(event.data.inboxID)
      const message: SessionMessage.Info | undefined =
        input.type === "user"
          ? {
              id: event.data.inboxID,
              type: "user" as const,
              text: input.payload.text,
              ...(input.payload.metadata === undefined ? {} : { metadata: input.payload.metadata }),
              ...(input.payload.files === undefined ? {} : { files: input.payload.files }),
              ...(input.payload.agents === undefined ? {} : { agents: input.payload.agents }),
              time: { created: event.created },
            }
          : input.type === "synthetic"
            ? {
                id: event.data.inboxID,
                type: "synthetic" as const,
                text: input.payload.text,
                ...(input.payload.metadata === undefined
                  ? {}
                  : { metadata: input.payload.metadata }),
                ...(input.payload.description === undefined
                  ? {}
                  : { description: input.payload.description }),
                time: { created: event.created },
              }
            : undefined
      if (message === undefined) return result(state.messages, [], pending)
      return result(
        state.messages.some((item) => item.id === message.id)
          ? state.messages
          : [...state.messages, message],
        [message.id],
        pending,
      )
    }
    case "session.execution.started":
      return {
        status: "applied",
        state: { ...state, execution: { _tag: "Running" } },
        touched: [],
      }
    case "session.step.started": {
      const current = state.messages.findLast(
        (item): item is Assistant => item.type === "assistant" && item.time.completed === undefined,
      )
      const completed =
        current !== undefined && current.id !== event.data.assistantMessageID
          ? update(state.messages, current.id, (item) =>
              item.type === "assistant"
                ? { ...item, retry: undefined, time: { ...item.time, completed: event.created } }
                : item,
            )
          : [...state.messages]
      const existing = completed.find((item) => item.id === event.data.assistantMessageID)
      if (existing?.type === "assistant") {
        return result(
          update(completed, existing.id, (item) =>
            item.type === "assistant"
              ? {
                  ...item,
                  agent: event.data.agent,
                  model: event.data.model,
                  retry: undefined,
                  error: undefined,
                  finish: undefined,
                  snapshot: event.data.snapshot
                    ? { ...item.snapshot, start: event.data.snapshot }
                    : item.snapshot,
                  time: { ...item.time, completed: undefined },
                }
              : item,
          ),
          current !== undefined && current.id !== existing.id
            ? [current.id, existing.id]
            : [existing.id],
        )
      }
      return result(
        [
          ...completed,
          {
            id: event.data.assistantMessageID,
            type: "assistant",
            metadata: event.metadata,
            agent: event.data.agent,
            model: event.data.model,
            content: [],
            snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            time: { created: event.created },
          },
        ],
        current === undefined
          ? [event.data.assistantMessageID]
          : [current.id, event.data.assistantMessageID],
      )
    }
    case "session.step.ended":
      return updateAssistant(state, event.data.assistantMessageID, (item) => ({
        ...item,
        finish: event.data.finish,
        cost: event.data.cost,
        tokens: event.data.tokens,
        snapshot:
          event.data.snapshot !== undefined || event.data.files !== undefined
            ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
            : item.snapshot,
        time: { ...item.time, completed: event.created },
      }))
    case "session.step.failed":
      return updateAssistant(state, event.data.assistantMessageID, (item) => ({
        ...item,
        finish: "error",
        error: event.data.error,
        retry: undefined,
        cost: event.data.cost ?? item.cost,
        tokens: event.data.tokens ?? item.tokens,
        snapshot:
          event.data.snapshot !== undefined || event.data.files !== undefined
            ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
            : item.snapshot,
        time: { ...item.time, completed: event.created },
      }))
    case "session.text.started":
      return updateAssistant(state, event.data.assistantMessageID, (item) => ({
        ...item,
        content: insertOrdinal(item.content, "text", event.data.ordinal, {
          type: "text",
          text: "",
        }),
      }))
    case "session.text.delta":
      return updateText(state, event.data.assistantMessageID, event.data.ordinal, (item) => ({
        ...item,
        text: item.text + event.data.delta,
      }))
    case "session.text.ended":
      return updateText(state, event.data.assistantMessageID, event.data.ordinal, (item) => ({
        ...item,
        text: event.data.text,
        state: event.data.state,
      }))
    case "session.reasoning.started":
      return updateAssistant(state, event.data.assistantMessageID, (item) => ({
        ...item,
        content: insertOrdinal(item.content, "reasoning", event.data.ordinal, {
          type: "reasoning",
          text: "",
          state: event.data.state,
          time: { created: event.created },
        }),
      }))
    case "session.reasoning.delta":
      return updateReasoning(state, event.data.assistantMessageID, event.data.ordinal, (item) => ({
        ...item,
        text: item.text + event.data.delta,
      }))
    case "session.reasoning.ended":
      return updateReasoning(state, event.data.assistantMessageID, event.data.ordinal, (item) => ({
        ...item,
        text: event.data.text,
        state: event.data.state ?? item.state,
        time: { created: item.time?.created ?? event.created, completed: event.created },
      }))
    case "session.tool.input.started":
      return updateAssistant(state, event.data.assistantMessageID, (item) => ({
        ...item,
        content: item.content.some(
          (content) => content.type === "tool" && content.id === event.data.id,
        )
          ? item.content
          : [
              ...item.content,
              {
                type: "tool",
                id: event.data.id,
                name: event.data.name,
                state: { status: "streaming", input: "" },
                time: { created: event.created },
              },
            ],
      }))
    case "session.tool.input.delta":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) =>
        tool.state.status === "streaming"
          ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
          : tool,
      )
    case "session.tool.input.ended":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) =>
        tool.state.status === "streaming"
          ? { ...tool, state: { ...tool.state, input: event.data.text } }
          : tool,
      )
    case "session.tool.called":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) => ({
        ...tool,
        executed: event.data.executed,
        providerState: event.data.state,
        state: { status: "running", input: event.data.input, metadata: {} },
        time: { ...tool.time, ran: event.created },
      }))
    case "session.tool.progress":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) =>
        tool.state.status === "running"
          ? { ...tool, state: { ...tool.state, metadata: event.data.metadata } }
          : tool,
      )
    case "session.tool.success":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) =>
        tool.state.status === "running"
          ? {
              ...tool,
              executed: event.data.executed || tool.executed === true,
              providerResultState: event.data.resultState,
              state: {
                status: "completed",
                input: tool.state.input,
                metadata: event.data.metadata,
                content: event.data.content,
              },
              time: { ...tool.time, completed: event.created },
            }
          : tool,
      )
    case "session.tool.failed":
      return updateTool(state, event.data.assistantMessageID, event.data.id, (tool) => {
        if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
        return {
          ...tool,
          executed: event.data.executed || tool.executed === true,
          providerResultState: event.data.resultState,
          state: {
            status: "error",
            input: typeof tool.state.input === "string" ? {} : tool.state.input,
            metadata:
              event.data.metadata ?? (tool.state.status === "running" ? tool.state.metadata : {}),
            ...(event.data.content === undefined ? {} : { content: event.data.content }),
            error: event.data.error,
          },
          time: { ...tool.time, completed: event.created },
        }
      })
    case "session.retry.scheduled":
      return updateAssistant(
        {
          ...state,
          execution: {
            _tag: "Retrying",
            attempt: event.data.attempt,
            at: event.data.at,
            message: event.data.error.message,
          },
        },
        event.data.assistantMessageID,
        (item) => ({
          ...item,
          retry: {
            attempt: event.data.attempt,
            at: DateTime.makeUnsafe(event.data.at),
            error: event.data.error,
          },
        }),
      )
    case "session.execution.succeeded":
    case "session.execution.interrupted": {
      const current = state.messages.findLast(
        (item): item is Assistant => item.type === "assistant" && item.time.completed === undefined,
      )
      return current?.retry === undefined
        ? { status: "applied", state: { ...state, execution: { _tag: "Idle" } }, touched: [] }
        : updateAssistant({ ...state, execution: { _tag: "Idle" } }, current.id, (item) => ({
            ...item,
            retry: undefined,
          }))
    }
    case "session.execution.failed": {
      const current = state.messages.findLast(
        (item): item is Assistant => item.type === "assistant" && item.time.completed === undefined,
      )
      const failed = {
        ...state,
        execution: { _tag: "Failed" as const, message: event.data.error.message },
      }
      return current?.retry === undefined
        ? { status: "applied", state: failed, touched: [] }
        : updateAssistant(failed, current.id, (item) => ({ ...item, retry: undefined }))
    }
    case "session.compaction.started":
      return append({
        id: event.data.inputID ?? messageID(event.id),
        type: "compaction",
        status: "running",
        metadata: event.metadata,
        reason: event.data.reason,
        summary: "",
        recent: event.data.recent,
        time: { created: event.created },
      })
    case "session.compaction.delta":
      return updateCompaction(state, (item) => ({
        ...item,
        summary: item.summary + event.data.text,
      }))
    case "session.compaction.ended": {
      const current = state.messages.findLast(
        (item): item is Extract<Compaction, { status: "running" }> =>
          item.type === "compaction" && item.status === "running",
      )
      return current === undefined
        ? append({
            id: messageID(event.id),
            type: "compaction",
            status: "completed",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          })
        : result(
            update(state.messages, current.id, () => ({
              ...current,
              status: "completed",
              reason: event.data.reason,
              summary: event.data.text,
              recent: event.data.recent,
            })),
            [current.id],
          )
    }
    case "session.compaction.failed": {
      const current = state.messages.findLast(
        (item): item is Extract<Compaction, { status: "running" }> =>
          item.type === "compaction" && item.status === "running",
      )
      const failed: Extract<Compaction, { status: "failed" }> = {
        id: current?.id ?? event.data.inputID ?? messageID(event.id),
        type: "compaction",
        status: "failed",
        metadata: current?.metadata ?? event.metadata,
        reason: event.data.reason,
        error: event.data.error,
        time: current?.time ?? { created: event.created },
      }
      return current === undefined
        ? append(failed)
        : result(
            update(state.messages, current.id, () => failed),
            [failed.id],
          )
    }
    default:
      return result(state.messages)
  }
}

function messageID(eventID: OpenCodeEvent["id"]): SessionMessage.ID {
  return SessionMessage.ID.fromEvent(eventID)
}

function update(
  source: ReadonlyArray<SessionMessage.Info>,
  id: string,
  apply: (item: SessionMessage.Info) => SessionMessage.Info,
): ReadonlyArray<SessionMessage.Info> {
  return source.map((item) => (item.id === id ? apply(item) : item))
}

function updateAssistant(
  state: SessionLogState,
  id: string,
  apply: (item: Assistant) => Assistant,
): {
  readonly status: "applied"
  readonly state: SessionLogState
  readonly touched: ReadonlyArray<string>
} {
  const exists = state.messages.some((item) => item.id === id && item.type === "assistant")
  return {
    status: "applied",
    state: {
      ...state,
      messages: update(state.messages, id, (item) =>
        item.type === "assistant" ? apply(item) : item,
      ),
    },
    touched: exists ? [id] : [],
  }
}

function updateText(
  state: SessionLogState,
  messageIDValue: string,
  ordinal: number,
  apply: (item: Text) => Text,
) {
  return updateAssistant(state, messageIDValue, (assistant) => {
    let index = -1
    return {
      ...assistant,
      content: assistant.content.map((item) => {
        if (item.type !== "text" || ++index !== ordinal) return item
        return apply(item)
      }),
    }
  })
}

function updateReasoning(
  state: SessionLogState,
  messageIDValue: string,
  ordinal: number,
  apply: (item: Reasoning) => Reasoning,
) {
  return updateAssistant(state, messageIDValue, (assistant) => {
    let index = -1
    return {
      ...assistant,
      content: assistant.content.map((item) => {
        if (item.type !== "reasoning" || ++index !== ordinal) return item
        return apply(item)
      }),
    }
  })
}

function updateTool(
  state: SessionLogState,
  messageIDValue: string,
  toolID: string,
  apply: (item: Tool) => Tool,
) {
  return updateAssistant(state, messageIDValue, (assistant) => ({
    ...assistant,
    content: assistant.content.map((item) =>
      item.type === "tool" && item.id === toolID ? apply(item) : item,
    ),
  }))
}

function updateCompaction(
  state: SessionLogState,
  apply: (
    item: Extract<Compaction, { status: "running" }>,
  ) => Extract<Compaction, { status: "running" }>,
) {
  const current = state.messages.findLast(
    (item): item is Extract<Compaction, { status: "running" }> =>
      item.type === "compaction" && item.status === "running",
  )
  return current === undefined
    ? {
        status: "applied" as const,
        state: { ...state, messages: [...state.messages] },
        touched: [],
      }
    : {
        status: "applied" as const,
        state: {
          ...state,
          messages: update(state.messages, current.id, (item) =>
            item.type === "compaction" && item.status === "running" ? apply(item) : item,
          ),
        },
        touched: [current.id],
      }
}

function insertOrdinal<T extends AssistantContent["type"]>(
  source: Assistant["content"],
  type: T,
  ordinal: number,
  item: Extract<AssistantContent, { type: T }>,
): Assistant["content"] {
  if (source.filter((content) => content.type === type)[ordinal] !== undefined) return source
  return [...source, item]
}
