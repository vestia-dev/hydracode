import {
  Location,
  Session,
  SessionMessage,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { Context, DateTime, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { Schema } from "effect"
import {
  reduceSessionLog,
  hydrateSessionLogState,
  type SessionLogState,
} from "../../shared/projectors/sessionLog"
import type {
  ProjectDetails,
  ProjectCatalogItem,
  ProjectSession,
  ProjectSnapshot,
  ProjectUpdate,
} from "../../shared/project"
import type { CreateSessionResult } from "../../shared/project"
import {
  projectCatalogItems,
  projectName,
  projectSessionSummaries,
  sessionRootID,
} from "../../shared/projectors/projectCatalog"
import { OpenCodeService } from "./OpenCodeService"

export class ProjectRegistryError extends Schema.TaggedErrorClass<ProjectRegistryError>()(
  "ProjectRegistryError",
  { message: Schema.String },
) {}

interface Subscriber {
  readonly id: string
  readonly location: Location.Ref
  readonly notify: (subscriptionID: string, update: ProjectUpdate) => void
}
interface Entry {
  project: ProjectDetails
  readonly directories: Set<string>
  readonly client: OpenCodeClient
  readonly info: Map<string, Session.Info>
  readonly sessions: Map<string, ProjectSession>
  readonly logs: Map<string, SessionLogState>
  readonly active: Set<string>
  readonly subscribers: Map<string, Subscriber>
  readonly queued: Array<OpenCodeEvent>
  selectedRootID?: string
  bootstrapping: boolean
  ready: boolean
  fiber?: Fiber.Fiber<never, unknown>
}

interface ProjectRegistryShape {
  readonly list: Effect.Effect<ReadonlyArray<ProjectCatalogItem>, unknown>
  readonly open: (
    location: Location.Ref,
    notify: (subscriptionID: string, update: ProjectUpdate) => void,
  ) => Effect.Effect<string, unknown>
  readonly close: (subscriptionID: string) => Effect.Effect<void, unknown>
  readonly selectSession: (
    subscriptionID: string,
    sessionID: string,
  ) => Effect.Effect<void, unknown>
  readonly createSession: (subscriptionID: string) => Effect.Effect<CreateSessionResult, unknown>
  readonly submitPrompt: (
    subscriptionID: string,
    sessionID: string,
    text: string,
  ) => Effect.Effect<void, unknown>
  readonly interrupt: (subscriptionID: string, sessionID: string) => Effect.Effect<void, unknown>
}

export class ProjectRegistry extends Context.Service<ProjectRegistry, ProjectRegistryShape>()(
  "HydraCode/ProjectRegistry",
) {}

const nextID = () => `project-${crypto.randomUUID()}`
const emit = (entry: Entry, update: ProjectUpdate) => {
  for (const subscriber of entry.subscribers.values()) subscriber.notify(subscriber.id, update)
}
const snapshot = (entry: Entry, location: Location.Ref): ProjectSnapshot => {
  const catalog = Array.from(entry.info.values(), (session) => ({
    id: String(session.id),
    ...(session.parentID == null ? {} : { parentID: String(session.parentID) }),
    created: DateTime.toEpochMillis(session.time.created),
    title: session.title ?? "Untitled session",
  }))
  return {
    project: entry.project,
    location,
    sessions: Array.from(entry.sessions.values()),
    recentSessions: projectSessionSummaries(catalog, entry.active),
  }
}
const sessionView = (entry: Entry, sessionID: string, state: SessionLogState): ProjectSession => {
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
const isSelected = (entry: Entry, session: Session.Info) =>
  entry.selectedRootID !== undefined && sessionRootID(session, entry.info) === entry.selectedRootID

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

export const ProjectRegistryLive = Layer.effect(
  ProjectRegistry,
  Effect.gen(function* () {
    const openCode = yield* OpenCodeService
    const scope = yield* Scope.Scope
    const entries = new Map<string, Entry>()
    const subscriptions = new Map<string, { entry: Entry; subscriber: Subscriber }>()
    const emitSnapshot = (entry: Entry) => {
      for (const subscriber of entry.subscribers.values()) {
        subscriber.notify(subscriber.id, {
          _tag: "Snapshot",
          snapshot: snapshot(entry, subscriber.location),
        })
      }
    }

    const list: Effect.Effect<ReadonlyArray<ProjectCatalogItem>, unknown> = openCode.client.pipe(
      Effect.flatMap((client) => client.project.list()),
      Effect.map(projectCatalogItems),
    )

    const removeSession = (entry: Entry, sessionID: string) =>
      Effect.sync(() => {
        entry.info.delete(sessionID)
        entry.logs.delete(sessionID)
        entry.sessions.delete(sessionID)
        entry.active.delete(sessionID)
        if (entry.ready) {
          emit(entry, { _tag: "Removed", projectID: entry.project.id, sessionID })
        }
      })

    const publish = (entry: Entry, sessionID: string) => {
      const state = entry.logs.get(sessionID)
      if (state === undefined) return
      const next = sessionView(entry, sessionID, state)
      entry.sessions.set(sessionID, next)
      if (entry.ready) emit(entry, { _tag: "Session", projectID: entry.project.id, session: next })
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
          if (info.projectID !== entry.project.id) return removeSession(entry, info.id)
          entry.info.set(info.id, info)
          if (!isSelected(entry, info)) {
            if (entry.ready) emitSnapshot(entry)
            return Effect.void
          }
          const state = entry.logs.get(info.id)
          if (state === undefined) return hydrate(entry, info)
          const next = sessionView(entry, info.id, state)
          entry.sessions.set(info.id, next)
          if (entry.ready) {
            emit(entry, { _tag: "Session", projectID: entry.project.id, session: next })
          }
          return Effect.void
        }),
      )

    const rehydrateSession = (entry: Entry, sessionID: Session.ID) =>
      entry.client.session.get({ sessionID }).pipe(Effect.flatMap((info) => hydrate(entry, info)))

    const apply = (entry: Entry, event: OpenCodeEvent): Effect.Effect<void, ProjectRegistryError> =>
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
                  new ProjectRegistryError({
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
          cause instanceof ProjectRegistryError
            ? cause
            : new ProjectRegistryError({ message: `Could not update session ${String(cause)}` }),
        ),
      )

    const reconcileSessions = (entry: Entry) =>
      Effect.gen(function* () {
        const [page, active] = yield* Effect.all(
          [
            entry.client.session.list({
              project: entry.project.id,
              limit: 50,
              order: "desc",
            }),
            entry.client.session.active(),
          ],
          { concurrency: "unbounded" },
        )
        entry.active.clear()
        for (const id of Object.keys(active)) entry.active.add(id)
        const availableIDs = new Set<string>(page.data.map((info) => info.id))
        for (const sessionID of entry.info.keys()) {
          if (!availableIDs.has(sessionID)) yield* removeSession(entry, sessionID)
        }
        for (const info of page.data) entry.info.set(info.id, info)
        if (
          entry.selectedRootID !== undefined &&
          !page.data.some((info) => info.id === entry.selectedRootID)
        ) {
          delete entry.selectedRootID
          entry.logs.clear()
          entry.sessions.clear()
        }
        const selected = page.data.filter((info) => isSelected(entry, info))
        yield* Effect.forEach(selected, (info) => hydrate(entry, info), { concurrency: 4 })
        if (entry.ready) emitSnapshot(entry)
      })

    const processEvent = (
      entry: Entry,
      event: OpenCodeEvent,
    ): Effect.Effect<void, ProjectRegistryError> =>
      Effect.gen(function* () {
        if (event.type === "server.connected") {
          yield* reconcileSessions(entry)
          return
        }
        if (event.type === "project.directories.updated") {
          if (event.data.projectID !== entry.project.id) return
          const directories = yield* entry.client.project.directories({
            projectID: entry.project.id,
          })
          entry.directories.clear()
          for (const item of directories) entry.directories.add(item.directory)
          yield* reconcileSessions(entry)
          return
        }
        if (!("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(event.data.sessionID)
        const known = entry.info.has(sessionID)
        const belongsToProject =
          known ||
          (event.type === "session.created" && event.data.projectID === entry.project.id) ||
          (event.type === "session.moved" && event.data.projectID === entry.project.id) ||
          (event.location !== undefined && entry.directories.has(event.location.directory))
        if (!belongsToProject) return
        if (event.type === "session.deleted") {
          yield* removeSession(entry, sessionID)
          return
        }
        if (
          event.type === "session.moved" &&
          event.data.projectID !== undefined &&
          event.data.projectID !== entry.project.id
        ) {
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
        if (!entry.logs.has(sessionID)) return
        yield* apply(entry, event)
      }).pipe(
        Effect.mapError(
          () =>
            new ProjectRegistryError({
              message: `Could not reconcile project ${entry.project.id}`,
            }),
        ),
      )

    const watchProject = (entry: Entry) => {
      const handle = (event: OpenCodeEvent): Effect.Effect<void, ProjectRegistryError> =>
        entry.bootstrapping
          ? Effect.sync(() => {
              entry.queued.push(event)
            })
          : processEvent(entry, event)
      const consume = entry.client.event.subscribe().pipe(Stream.runForEach(handle))
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
              project: entry.project.id,
              limit: 50,
              order: "desc",
            }),
            entry.client.session.active(),
          ],
          { concurrency: "unbounded" },
        )
        for (const id of Object.keys(active)) entry.active.add(id)
        for (const info of page.data) entry.info.set(info.id, info)
        entry.bootstrapping = true
        yield* Effect.forkChild(watchProject(entry))
        entry.bootstrapping = false
        const queued = entry.queued.splice(0)
        yield* Effect.forEach(queued, (event) => processEvent(entry, event), { concurrency: 1 })
        entry.ready = true
        emitSnapshot(entry)
        return yield* Effect.never
      })

    const open = (
      location: Location.Ref,
      notify: (subscriptionID: string, update: ProjectUpdate) => void,
    ): Effect.Effect<string, unknown> =>
      Effect.gen(function* () {
        const client = yield* openCode.client
        const current = yield* client.project.current({
          location: {
            directory: location.directory,
            ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
          },
        })
        const [projects, directories] = yield* Effect.all(
          [client.project.list(), client.project.directories({ projectID: current.id })],
          { concurrency: "unbounded" },
        )
        const info = projects.find((project) => project.id === current.id)
        const project: ProjectDetails = {
          id: current.id,
          canonical: info?.canonical ?? current.canonical,
          ...projectName(info?.name),
          ...(info?.icon === undefined ? {} : { icon: info.icon }),
        }
        const resolvedLocation = Location.Ref.make({
          directory: current.directory,
          ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
        })
        const knownDirectories = new Set(directories.map((item) => item.directory))
        knownDirectories.add(current.directory)
        const key = current.id
        let entry = entries.get(key)
        if (entry === undefined) {
          entry = {
            project,
            directories: knownDirectories,
            client,
            info: new Map(),
            sessions: new Map(),
            logs: new Map(),
            active: new Set(),
            subscribers: new Map(),
            queued: [],
            bootstrapping: false,
            ready: false,
          }
        } else {
          entry.project = project
          for (const directory of knownDirectories) entry.directories.add(directory)
        }
        const subscriptionID = nextID()
        const subscriber = { id: subscriptionID, location: resolvedLocation, notify }
        entry.subscribers.set(subscriptionID, subscriber)
        subscriptions.set(subscriptionID, { entry, subscriber })
        if (entry.fiber === undefined) {
          entry.fiber = yield* Effect.forkIn(start(entry), scope)
        } else if (entry.ready) {
          notify(subscriptionID, {
            _tag: "Snapshot",
            snapshot: snapshot(entry, resolvedLocation),
          })
        }
        entries.set(key, entry)
        return subscriptionID
      })
    const close = (subscriptionID: string): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined) return
        const { entry } = subscription
        entry.subscribers.delete(subscriptionID)
        subscriptions.delete(subscriptionID)
        if (entry.subscribers.size === 0) {
          entries.delete(entry.project.id)
          if (entry.fiber !== undefined) yield* Fiber.interrupt(entry.fiber)
        }
      })
    const selectSession = (
      subscriptionID: string,
      sessionID: string,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        let target = entry.info.get(sessionID)
        if (target === undefined) {
          target = yield* entry.client.session.get({
            sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
          })
          entry.info.set(target.id, target)
        }
        entry.selectedRootID = sessionRootID(target, entry.info)
        entry.logs.clear()
        entry.sessions.clear()
        const family = Array.from(entry.info.values()).filter((info) => isSelected(entry, info))
        yield* Effect.forEach(family, (info) => hydrate(entry, info), { concurrency: 4 })
        return yield* Effect.sync(() => emitSnapshot(entry))
      })
    const createSession = (subscriptionID: string): Effect.Effect<CreateSessionResult, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry, subscriber } = subscription
        const info = yield* entry.client.session.create({
          location: subscriber.location,
        })
        entry.info.set(info.id, info)
        entry.selectedRootID = info.id
        entry.logs.clear()
        entry.sessions.clear()
        yield* hydrate(entry, info)
        emitSnapshot(entry)
        const session = entry.sessions.get(info.id)
        if (session === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "The new session could not be projected." }),
          )
        return { _tag: "Success", session } as const
      })
    const submitPrompt = (
      subscriptionID: string,
      sessionID: string,
      text: string,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        if (text.trim() === "")
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Enter a prompt before sending." }),
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
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        return yield* entry.client.session.interrupt({
          sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
        })
      })
    return ProjectRegistry.of({
      list,
      open,
      close,
      selectSession,
      createSession,
      submitPrompt,
      interrupt,
    })
  }),
)
