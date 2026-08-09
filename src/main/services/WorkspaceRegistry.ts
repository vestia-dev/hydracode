import {
  AbsolutePath,
  Session,
  SessionMessage,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { Context, DateTime, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { Schema } from "effect"
import { realpathSync } from "node:fs"
import {
  reduceSessionLog,
  createSessionLogState,
  hydrateSessionLogState,
  type SessionLogState,
} from "../../shared/projectors/sessionLog"
import type { WorkspaceSession, WorkspaceSnapshot, WorkspaceUpdate } from "../../shared/workspace"
import { OpenCodeService } from "./OpenCodeService"

export class WorkspaceRegistryError extends Schema.TaggedErrorClass<WorkspaceRegistryError>()(
  "WorkspaceRegistryError",
  { message: Schema.String },
) {}

interface Subscriber {
  readonly id: string
  readonly notify: (subscriptionID: string, update: WorkspaceUpdate) => void
}
interface Entry {
  readonly directory: string
  readonly client: OpenCodeClient
  readonly info: Map<string, Session.Info>
  readonly sessions: Map<string, WorkspaceSession>
  readonly logs: Map<string, SessionLogState>
  readonly active: Set<string>
  readonly subscribers: Map<string, Subscriber>
  readonly queued: Array<OpenCodeEvent>
  bootstrapping: boolean
  ready: boolean
  fiber?: Fiber.Fiber<never, unknown>
}

interface WorkspaceRegistryShape {
  readonly open: (
    directory: string,
    notify: (subscriptionID: string, update: WorkspaceUpdate) => void,
  ) => Effect.Effect<string, unknown>
  readonly close: (subscriptionID: string) => Effect.Effect<void, unknown>
  readonly submitPrompt: (
    subscriptionID: string,
    sessionID: string,
    text: string,
  ) => Effect.Effect<void, unknown>
  readonly interrupt: (subscriptionID: string, sessionID: string) => Effect.Effect<void, unknown>
}

export class WorkspaceRegistry extends Context.Service<WorkspaceRegistry, WorkspaceRegistryShape>()(
  "HydraCode/WorkspaceRegistry",
) {}

const nextID = () => `workspace-${crypto.randomUUID()}`
const canonical = (directory: string) => realpathSync.native(directory)
const emit = (entry: Entry, update: WorkspaceUpdate) => {
  for (const subscriber of entry.subscribers.values()) subscriber.notify(subscriber.id, update)
}
const snapshot = (entry: Entry): WorkspaceSnapshot => ({
  directory: entry.directory,
  sessions: Array.from(entry.sessions.values()),
})
const sessionView = (entry: Entry, sessionID: string, state: SessionLogState): WorkspaceSession => {
  const info = entry.info.get(sessionID)
  if (info === undefined) {
    throw new Error(`Session metadata is missing for ${sessionID}`)
  }
  return {
    id: info.id,
    ...(info.parentID == null ? {} : { parentID: info.parentID }),
    created: DateTime.toEpochMillis(info.time.created),
    title: info.title ?? "Untitled session",
    active:
      state.execution._tag === "Running" ||
      state.execution._tag === "Retrying" ||
      entry.active.has(info.id),
    synchronized: state.synchronized,
    execution: state.execution,
    messages: state.messages,
  }
}
function rootID(session: Session.Info, byID: ReadonlyMap<string, Session.Info>) {
  let current = session
  const seen = new Set([current.id])
  while (current.parentID != null) {
    const parent = byID.get(current.parentID)
    if (parent === undefined || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
  }
  return current.id
}

function visibleSessionFamily(
  sessions: ReadonlyArray<Session.Info>,
  activeIDs: ReadonlySet<string>,
) {
  const byID = new Map<string, Session.Info>(sessions.map((session) => [session.id, session]))
  const activeRoots = new Set(
    sessions.filter((session) => activeIDs.has(session.id)).map((session) => rootID(session, byID)),
  )
  const selectedRoots =
    activeRoots.size > 0
      ? activeRoots
      : new Set(sessions[0] === undefined ? [] : [rootID(sessions[0], byID)])
  return sessions.filter((session) => selectedRoots.has(rootID(session, byID)))
}

const captureWatermark = (client: OpenCodeClient, sessionID: Session.ID) => {
  let current: number | undefined
  return client.session.log({ sessionID, follow: false }).pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        if (event.type === "log.synced") current = event.seq
      }),
    ),
    Effect.asVoid,
    Effect.map(() => current),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

export const WorkspaceRegistryLive = Layer.effect(
  WorkspaceRegistry,
  Effect.gen(function* () {
    const openCode = yield* OpenCodeService
    const scope = yield* Scope.Scope
    const entries = new Map<string, Entry>()
    const subscriptions = new Map<string, Entry>()

    const removeSession = (entry: Entry, sessionID: string) =>
      Effect.sync(() => {
        entry.info.delete(sessionID)
        entry.logs.delete(sessionID)
        entry.sessions.delete(sessionID)
        entry.active.delete(sessionID)
        if (entry.ready) {
          emit(entry, { _tag: "Removed", directory: entry.directory, sessionID })
        }
      })

    const publish = (entry: Entry, sessionID: string) => {
      const state = entry.logs.get(sessionID)
      if (state === undefined) return
      const next = sessionView(entry, sessionID, state)
      entry.sessions.set(sessionID, next)
      if (entry.ready) emit(entry, { _tag: "Session", directory: entry.directory, session: next })
    }

    const hydrate = (entry: Entry, info: Session.Info) =>
      Effect.gen(function* () {
        entry.info.set(info.id, info)
        const sequence = yield* captureWatermark(entry.client, info.id)
        const messages = yield* entry.client.session.context({ sessionID: info.id })
        entry.logs.set(info.id, hydrateSessionLogState(info.id, messages, sequence))
        publish(entry, info.id)
      })

    const refreshSession = (entry: Entry, sessionID: Session.ID) =>
      entry.client.session.get({ sessionID }).pipe(
        Effect.flatMap((info) => {
          entry.info.set(info.id, info)
          const state = entry.logs.get(info.id)
          if (state === undefined) return hydrate(entry, info)
          const next = sessionView(entry, info.id, state)
          entry.sessions.set(info.id, next)
          if (entry.ready) {
            emit(entry, { _tag: "Session", directory: entry.directory, session: next })
          }
          return Effect.void
        }),
      )

    const rehydrateSession = (entry: Entry, sessionID: Session.ID) =>
      entry.client.session.get({ sessionID }).pipe(Effect.flatMap((info) => hydrate(entry, info)))

    const apply = (
      entry: Entry,
      event: OpenCodeEvent,
    ): Effect.Effect<void, WorkspaceRegistryError> =>
      Effect.gen(function* () {
        if (!("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(event.data.sessionID)
        const current = entry.logs.get(sessionID)
        if (current === undefined) {
          yield* refreshSession(entry, sessionID)
          return
        }
        const reduction = reduceSessionLog(current, event)
        if (reduction.status === "gap") {
          yield* rehydrateSession(entry, sessionID)
          return
        }
        if (reduction.status === "duplicate" || reduction.status === "ignored") return
        if (event.type === "session.execution.started") entry.active.add(sessionID)
        if (
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.interrupted" ||
          event.type === "session.execution.failed"
        )
          entry.active.delete(sessionID)
        if (reduction.status === "missing-input") {
          const message = yield* entry.client.session
            .message({
              sessionID,
              messageID: Schema.decodeUnknownSync(SessionMessage.ID)(reduction.inputID),
            })
            .pipe(
              Effect.mapError(
                () =>
                  new WorkspaceRegistryError({
                    message: `Could not hydrate session input ${reduction.inputID}`,
                  }),
              ),
            )
          entry.logs.set(sessionID, {
            ...reduction.state,
            messages: [
              ...reduction.state.messages.filter((item) => item.id !== message.id),
              message,
            ],
          })
        } else entry.logs.set(sessionID, reduction.state)
        publish(entry, sessionID)
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof WorkspaceRegistryError
            ? cause
            : new WorkspaceRegistryError({ message: `Could not update session ${String(cause)}` }),
        ),
      )

    const reconcileSessions = (entry: Entry) =>
      Effect.gen(function* () {
        const [page, active] = yield* Effect.all(
          [
            entry.client.session.list({
              directory: AbsolutePath.make(entry.directory),
              limit: 50,
              order: "desc",
            }),
            entry.client.session.active(),
          ],
          { concurrency: "unbounded" },
        )
        entry.active.clear()
        for (const id of Object.keys(active)) entry.active.add(id)
        const visible = visibleSessionFamily(page.data, new Set(Object.keys(active)))
        const visibleIDs = new Set<string>(visible.map((info) => info.id))
        for (const sessionID of entry.info.keys())
          if (!visibleIDs.has(sessionID)) yield* removeSession(entry, sessionID)
        yield* Effect.forEach(visible, (info) => hydrate(entry, info), { concurrency: 4 })
      })

    const processEvent = (
      entry: Entry,
      event: OpenCodeEvent,
    ): Effect.Effect<void, WorkspaceRegistryError> =>
      Effect.gen(function* () {
        if (event.type === "server.connected") {
          yield* reconcileSessions(entry)
          return
        }
        const inWorkspace =
          event.location?.directory === entry.directory ||
          (event.type === "session.moved" && event.data.location.directory === entry.directory)
        if (
          !inWorkspace ||
          !("sessionID" in event.data) ||
          typeof event.data.sessionID !== "string"
        )
          return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(event.data.sessionID)
        if (event.type === "session.deleted") {
          yield* removeSession(entry, sessionID)
          return
        }
        if (event.type === "session.moved" && event.data.location.directory !== entry.directory) {
          yield* removeSession(entry, sessionID)
          return
        }
        if (
          event.type === "session.created" ||
          event.type === "session.renamed" ||
          event.type === "session.moved" ||
          event.type === "session.forked"
        ) {
          yield* refreshSession(entry, sessionID)
        }
        yield* apply(entry, event)
      }).pipe(
        Effect.mapError(
          () =>
            new WorkspaceRegistryError({
              message: `Could not reconcile workspace ${entry.directory}`,
            }),
        ),
      )

    const watchWorkspace = (entry: Entry) => {
      const handle = (event: OpenCodeEvent): Effect.Effect<void, WorkspaceRegistryError> =>
        entry.bootstrapping
          ? Effect.sync(() => {
              entry.queued.push(event)
            })
          : processEvent(entry, event)
      const consume = entry.client.event.subscribe().pipe(
        Stream.filter(
          (event) =>
            event.type === "server.connected" ||
            event.location?.directory === entry.directory ||
            (event.type === "session.moved" && event.data.location.directory === entry.directory),
        ),
        Stream.runForEach(handle),
      )
      const loop: Effect.Effect<never> = consume.pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("OpenCode event stream disconnected", cause)
            if (!entry.ready)
              emit(entry, {
                _tag: "Error",
                message:
                  cause instanceof Error ? cause.message : "OpenCode event stream disconnected",
              })
            yield* Effect.sleep("500 millis")
          }),
        ),
        Effect.andThen(Effect.suspend(() => loop)),
      )
      return loop
    }

    const start = (entry: Entry) =>
      Effect.gen(function* () {
        const [page, active] = yield* Effect.all(
          [
            entry.client.session.list({
              directory: AbsolutePath.make(entry.directory),
              limit: 50,
              order: "desc",
            }),
            entry.client.session.active(),
          ],
          { concurrency: "unbounded" },
        )
        const visible: ReadonlyArray<Session.Info> = visibleSessionFamily(
          page.data,
          new Set(Object.keys(active)),
        )
        for (const id of Object.keys(active)) entry.active.add(id)
        for (const info of visible) {
          const state = createSessionLogState(info.id)
          entry.info.set(info.id, info)
          entry.logs.set(info.id, state)
          entry.sessions.set(info.id, {
            id: info.id,
            ...(info.parentID == null ? {} : { parentID: info.parentID }),
            created: DateTime.toEpochMillis(info.time.created),
            title: info.title ?? "Untitled session",
            active: Object.hasOwn(active, info.id),
            synchronized: false,
            execution: Object.hasOwn(active, info.id) ? { _tag: "Running" } : { _tag: "Idle" },
            messages: [],
          })
        }
        entry.bootstrapping = true
        yield* Effect.forkChild(watchWorkspace(entry))
        yield* Effect.forEach(visible, (info) => hydrate(entry, info), { concurrency: 4 })
        entry.bootstrapping = false
        const queued = entry.queued.splice(0)
        yield* Effect.forEach(queued, (event) => processEvent(entry, event), { concurrency: 1 })
        entry.ready = true
        emit(entry, { _tag: "Snapshot", snapshot: snapshot(entry) })
        return yield* Effect.never
      })

    const open = (
      directory: string,
      notify: (subscriptionID: string, update: WorkspaceUpdate) => void,
    ): Effect.Effect<string, unknown> =>
      Effect.gen(function* () {
        const key = canonical(directory)
        let entry = entries.get(key)
        if (entry === undefined) {
          entry = {
            directory: key,
            client: yield* openCode.client,
            info: new Map(),
            sessions: new Map(),
            logs: new Map(),
            active: new Set(),
            subscribers: new Map(),
            queued: [],
            bootstrapping: false,
            ready: false,
          }
        }
        const subscriptionID = nextID()
        entry.subscribers.set(subscriptionID, { id: subscriptionID, notify })
        subscriptions.set(subscriptionID, entry)
        if (entry.fiber === undefined) {
          entry.fiber = yield* Effect.forkIn(start(entry), scope)
        } else if (entry.ready) {
          notify(subscriptionID, { _tag: "Snapshot", snapshot: snapshot(entry) })
        }
        entries.set(key, entry)
        return subscriptionID
      })
    const close = (subscriptionID: string): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const entry = subscriptions.get(subscriptionID)
        if (entry === undefined) return
        entry.subscribers.delete(subscriptionID)
        subscriptions.delete(subscriptionID)
        if (entry.subscribers.size === 0) {
          entries.delete(entry.directory)
          if (entry.fiber !== undefined) yield* Fiber.interrupt(entry.fiber)
        }
      })
    const submitPrompt = (
      subscriptionID: string,
      sessionID: string,
      text: string,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const entry = subscriptions.get(subscriptionID)
        if (entry === undefined)
          return yield* Effect.fail(
            new WorkspaceRegistryError({ message: "Workspace subscription is closed" }),
          )
        if (text.trim() === "")
          return yield* Effect.fail(
            new WorkspaceRegistryError({ message: "Enter a prompt before sending." }),
          )
        return yield* entry.client.session
          .prompt({
            sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
            text: text.trim(),
          })
          .pipe(Effect.asVoid)
      })
    const interrupt = (subscriptionID: string, sessionID: string): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const entry = subscriptions.get(subscriptionID)
        if (entry === undefined)
          return yield* Effect.fail(
            new WorkspaceRegistryError({ message: "Workspace subscription is closed" }),
          )
        return yield* entry.client.session.interrupt({
          sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
        })
      })
    return WorkspaceRegistry.of({ open, close, submitPrompt, interrupt })
  }),
)
