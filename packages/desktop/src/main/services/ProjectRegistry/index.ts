import {
  Location,
  Question,
  Session,
  SessionMessage,
  Project,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { Context, DateTime, Effect, Fiber, Layer, Queue, Scope, Stream } from "effect"
import { Schema } from "effect"
import { performance } from "node:perf_hooks"
import {
  reduceSessionLog,
  initializeSessionLogState,
  questionFormAnswer,
  questionFormID,
  questionFromForm,
  sessionIDFromEvent,
  type SessionLogState,
} from "../../../shared/domain/sessionLog"
import type {
  ProjectDetails,
  ProjectCatalogEntry,
  ProjectSession,
  ProjectSnapshot,
  ProjectUpdate,
  SessionLoadTiming,
  SessionSelectionTiming,
} from "../../../shared/project"
import type { CreateSessionResult } from "../../../shared/project"
import {
  availableProjects,
  projectName,
  createSessionSummaries,
  locationsEqual,
  locationKey,
  sessionRootID,
} from "../../../shared/domain/projectCatalog"
import { OpenCodeService } from "../OpenCodeService"

export class ProjectRegistryError extends Schema.TaggedErrorClass<ProjectRegistryError>()(
  "ProjectRegistryError",
  { message: Schema.String },
) {}

interface Subscriber {
  readonly id: string
  readonly location: Location.Ref
  readonly notify: (subscriptionID: string, update: ProjectUpdate) => void
}

type SessionRecord =
  | { readonly _tag: "Metadata"; readonly info: Session.Info }
  | {
      readonly _tag: "Loaded"
      readonly info: Session.Info
      readonly state: SessionLogState
    }

interface Entry {
  project: ProjectDetails
  readonly location: Location.Ref
  readonly directories: Set<string>
  readonly client: OpenCodeClient
  readonly sessions: Map<string, SessionRecord>
  readonly active: Set<string>
  readonly subscribers: Map<string, Subscriber>
  readonly events: Queue.Queue<OpenCodeEvent>
  readonly selectedRootIDs: Set<string>
  ready: boolean
  fiber?: Fiber.Fiber<never, unknown>
}

interface ProjectRegistryShape {
  readonly list: Effect.Effect<ReadonlyArray<ProjectCatalogEntry>, unknown>
  readonly resolve: (location: Location.Ref) => Effect.Effect<ProjectCatalogEntry, unknown>
  readonly open: (
    location: Location.Ref | undefined,
    notify: (subscriptionID: string, update: ProjectUpdate) => void,
  ) => Effect.Effect<string, unknown>
  readonly close: (subscriptionID: string) => Effect.Effect<void, unknown>
  readonly selectSession: (
    subscriptionID: string,
    sessionID: string,
  ) => Effect.Effect<SessionSelectionTiming, unknown>
  readonly createSession: (subscriptionID: string) => Effect.Effect<CreateSessionResult, unknown>
  readonly submitPrompt: (
    subscriptionID: string,
    sessionID: string,
    text: string,
  ) => Effect.Effect<void, unknown>
  readonly replyQuestion: (
    subscriptionID: string,
    sessionID: string,
    requestID: string,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, unknown>
  readonly rejectQuestion: (
    subscriptionID: string,
    sessionID: string,
    requestID: string,
  ) => Effect.Effect<void, unknown>
  readonly backgroundSession: (
    subscriptionID: string,
    sessionID: string,
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
const sessionInfo = (entry: Entry) =>
  new Map(Array.from(entry.sessions, ([id, record]) => [id, record.info] as const))
const setSessionInfo = (entry: Entry, info: Session.Info) => {
  const current = entry.sessions.get(info.id)
  entry.sessions.set(
    info.id,
    current?._tag === "Loaded"
      ? { _tag: "Loaded", info, state: current.state }
      : { _tag: "Metadata", info },
  )
}
const snapshot = (entry: Entry, location: Location.Ref): ProjectSnapshot => {
  const sessionMetadata = Array.from(entry.sessions.values())
    .map((record) => record.info)
    .filter((info) => locationsEqual(info.location, location))
    .map((info) => ({
      id: String(info.id),
      parentID: info.parentID == null ? undefined : String(info.parentID),
      created: DateTime.toEpochMillis(info.time.created),
      title: info.title ?? "Untitled session",
    }))
  return {
    project: entry.project,
    location,
    sessions: Array.from(entry.sessions.values()).flatMap((record) =>
      record._tag === "Loaded" && locationsEqual(record.info.location, location)
        ? [sessionView(entry, record)]
        : [],
    ),
    recentSessions: createSessionSummaries(sessionMetadata, entry.active),
  }
}
const sessionView = (
  entry: Entry,
  { info, state }: Extract<SessionRecord, { readonly _tag: "Loaded" }>,
): ProjectSession => {
  return {
    id: info.id,
    ...(info.parentID == null ? {} : { parentID: info.parentID }),
    location: info.location,
    created: DateTime.toEpochMillis(info.time.created),
    title: info.title ?? "Untitled session",
    active:
      state.execution._tag === "Running" ||
      state.execution._tag === "Retrying" ||
      entry.active.has(info.id),
    synchronized: state.synchronized,
    execution: state.execution,
    messages: state.messages,
    questions: state.questions,
  }
}
const isSelected = (entry: Entry, session: Session.Info) =>
  entry.selectedRootIDs.has(sessionRootID(session, sessionInfo(entry)))

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

const listSessions = (entry: Entry, location: Location.Ref) =>
  entry.client.session.list({
    project: entry.project.id,
    directory: location.directory,
    ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
    limit: 50,
    order: "desc",
  })

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

    const list: Effect.Effect<ReadonlyArray<ProjectCatalogEntry>, unknown> = Effect.gen(
      function* () {
        const client = yield* openCode.client
        const projects = yield* client.project.list()
        const locations = new Map<
          Project.ID,
          ReadonlyArray<import("../../../shared/project").ProjectLocation>
        >()
        yield* Effect.forEach(
          projects,
          (project) =>
            client.worktree.list({ projectID: project.id }).pipe(
              Effect.map((worktrees) =>
                locations.set(
                  project.id,
                  worktrees.map((worktree) => ({
                    ref: Location.Ref.make({ directory: worktree.directory }),
                    kind: "worktree" as const,
                  })),
                ),
              ),
            ),
          { concurrency: "unbounded" },
        )
        return availableProjects(projects, locations)
      },
    )

    const resolve = (location: Location.Ref) =>
      Effect.gen(function* () {
        const client = yield* openCode.client
        const current = yield* client.project.current({
          location: {
            directory: location.directory,
            ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
          },
        })
        const projects = yield* client.project.list()
        const info = projects.find((project) => project.id === current.id)
        return {
          project: {
            id: current.id,
            canonical: info?.canonical ?? current.canonical,
            ...projectName(info?.name),
            ...(info?.icon === undefined ? {} : { icon: info.icon }),
          },
          locations: [{ ref: location, kind: "selected" as const }],
          updated: info?.time.updated ?? Date.now(),
        }
      })

    const removeSession = (entry: Entry, sessionID: string) =>
      Effect.sync(() => {
        entry.sessions.delete(sessionID)
        entry.active.delete(sessionID)
        if (entry.ready) {
          emit(entry, { _tag: "Removed", projectID: entry.project.id, sessionID })
        }
      })

    const publish = (entry: Entry, sessionID: string) => {
      const record = entry.sessions.get(sessionID)
      if (record?._tag !== "Loaded") return
      const next = sessionView(entry, record)
      if (entry.ready) emit(entry, { _tag: "Session", projectID: entry.project.id, session: next })
    }

    const loadSessionState = (
      entry: Entry,
      info: Session.Info,
      selectionStarted?: number,
      timings?: Array<SessionLoadTiming>,
    ) =>
      Effect.gen(function* () {
        const started = performance.now()
        setSessionInfo(entry, info)
        const watermarkStarted = performance.now()
        const sequence = yield* captureWatermark(entry.client, info.id)
        const watermarkDuration = performance.now() - watermarkStarted
        let contextDuration = 0
        let questionsDuration = 0
        let formsDuration = 0
        const contextStarted = performance.now()
        const questionsStarted = performance.now()
        const formsStarted = performance.now()
        const [messages, questions, forms] = yield* Effect.all(
          [
            entry.client.session.context({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  contextDuration = performance.now() - contextStarted
                }),
              ),
            ),
            entry.client.question.list({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  questionsDuration = performance.now() - questionsStarted
                }),
              ),
            ),
            entry.client.form.list({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  formsDuration = performance.now() - formsStarted
                }),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        )
        const formQuestions = forms.flatMap((form) => {
          const question = questionFromForm(form)
          return question === undefined ? [] : [question]
        })
        const stateBuildStarted = performance.now()
        entry.sessions.set(info.id, {
          _tag: "Loaded",
          info,
          state: initializeSessionLogState(info.id, messages, sequence, [
            ...questions,
            ...formQuestions,
          ]),
        })
        publish(entry, info.id)
        const stateBuildDuration = performance.now() - stateBuildStarted
        if (selectionStarted !== undefined && timings !== undefined) {
          timings.push({
            sessionID: info.id,
            offset: started - selectionStarted,
            duration: performance.now() - started,
            watermarkDuration,
            contextDuration,
            questionsDuration,
            formsDuration,
            stateBuildDuration,
            messages: messages.length,
            questions: questions.length,
            forms: forms.length,
          })
        }
      })

    const refreshSession = (entry: Entry, sessionID: Session.ID) =>
      entry.client.session.get({ sessionID }).pipe(
        Effect.flatMap((info) => {
          if (info.projectID !== entry.project.id) return removeSession(entry, info.id)
          setSessionInfo(entry, info)
          if (!isSelected(entry, info)) {
            if (entry.ready) emitSnapshot(entry)
            return Effect.void
          }
          const record = entry.sessions.get(info.id)
          if (record?._tag !== "Loaded") return loadSessionState(entry, info)
          const next = sessionView(entry, record)
          if (entry.ready) {
            emit(entry, { _tag: "Session", projectID: entry.project.id, session: next })
          }
          return Effect.void
        }),
      )

    const reloadSessionState = (entry: Entry, sessionID: Session.ID) =>
      entry.client.session
        .get({ sessionID })
        .pipe(Effect.flatMap((info) => loadSessionState(entry, info)))

    const apply = (entry: Entry, event: OpenCodeEvent): Effect.Effect<void, ProjectRegistryError> =>
      Effect.gen(function* () {
        const eventSessionID = sessionIDFromEvent(event)
        if (eventSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(eventSessionID)
        const current = entry.sessions.get(sessionID)
        if (current?._tag !== "Loaded") {
          yield* refreshSession(entry, sessionID)
          return
        }
        const reduction = reduceSessionLog(current.state, event)
        if (reduction.status === "gap") {
          yield* reloadSessionState(entry, sessionID)
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
                    message: `Could not load missing session message ${reduction.inputID}`,
                  }),
              ),
            )
          entry.sessions.set(sessionID, {
            ...current,
            state: {
              ...reduction.state,
              messages: [
                ...reduction.state.messages.filter((item) => item.id !== message.id),
                message,
              ],
            },
          })
        } else entry.sessions.set(sessionID, { ...current, state: reduction.state })
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
          [listSessions(entry, entry.location), entry.client.session.active()],
          { concurrency: "unbounded" },
        )
        entry.active.clear()
        for (const id of Object.keys(active)) entry.active.add(id)
        const availableIDs = new Set<string>(page.data.map((info) => info.id))
        for (const sessionID of entry.sessions.keys()) {
          if (!availableIDs.has(sessionID)) yield* removeSession(entry, sessionID)
        }
        for (const info of page.data) setSessionInfo(entry, info)
        for (const rootID of entry.selectedRootIDs) {
          if (!page.data.some((info) => info.id === rootID)) entry.selectedRootIDs.delete(rootID)
        }
        const selected = page.data.filter((info) => isSelected(entry, info))
        yield* Effect.forEach(selected, (info) => loadSessionState(entry, info), {
          concurrency: 4,
        })
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
        if (event.type === "worktree.updated") {
          if (event.data.projectID !== entry.project.id) return
          const directories = yield* entry.client.worktree.list({
            projectID: entry.project.id,
          })
          entry.directories.clear()
          for (const item of directories) entry.directories.add(item.directory)
          yield* reconcileSessions(entry)
          return
        }
        const eventSessionID = sessionIDFromEvent(event)
        if (eventSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(eventSessionID)
        const known = entry.sessions.has(sessionID)
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
        if (entry.sessions.get(sessionID)?._tag !== "Loaded") return
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
      const consume = entry.client.event
        .subscribe()
        .pipe(Stream.runForEach((event) => Queue.offer(entry.events, event).pipe(Effect.asVoid)))
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
        yield* Effect.forkChild(watchProject(entry))
        yield* Effect.yieldNow
        const [page, active] = yield* Effect.all(
          [listSessions(entry, entry.location), entry.client.session.active()],
          { concurrency: "unbounded" },
        )
        for (const id of Object.keys(active)) entry.active.add(id)
        for (const info of page.data) setSessionInfo(entry, info)
        entry.ready = true
        emitSnapshot(entry)
        return yield* Effect.forever(
          Queue.take(entry.events).pipe(
            Effect.flatMap((event) => processEvent(entry, event)),
            Effect.catch((cause) => Effect.logWarning("Could not process OpenCode event", cause)),
          ),
        )
      })

    const open = (
      location: Location.Ref | undefined,
      notify: (subscriptionID: string, update: ProjectUpdate) => void,
    ): Effect.Effect<string, unknown> =>
      Effect.gen(function* () {
        const client = yield* openCode.client
        const current = yield* client.project.current(
          location === undefined
            ? undefined
            : {
                location: {
                  directory: location.directory,
                  ...(location.workspaceID === undefined
                    ? {}
                    : { workspace: location.workspaceID }),
                },
              },
        )
        const [projects, directories] = yield* Effect.all(
          [client.project.list(), client.worktree.list({ projectID: current.id })],
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
          directory: location?.directory ?? current.directory,
          ...(location?.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
        })
        const knownDirectories = new Set(directories.map((item) => item.directory))
        knownDirectories.add(resolvedLocation.directory)
        const key = `${current.id}:${locationKey(resolvedLocation)}`
        let entry = entries.get(key)
        if (entry === undefined) {
          const events = yield* Queue.unbounded<OpenCodeEvent>()
          entry = {
            project,
            location: resolvedLocation,
            directories: knownDirectories,
            client,
            sessions: new Map(),
            active: new Set(),
            selectedRootIDs: new Set(),
            subscribers: new Map(),
            events,
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
          entries.delete(`${entry.project.id}:${locationKey(entry.location)}`)
          if (entry.fiber !== undefined) yield* Fiber.interrupt(entry.fiber)
        }
      })
    const selectSession = (
      subscriptionID: string,
      sessionID: string,
    ): Effect.Effect<SessionSelectionTiming, unknown> =>
      Effect.gen(function* () {
        const started = performance.now()
        let sessionGetDuration = 0
        const loadTimings: Array<SessionLoadTiming> = []
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        let target = entry.sessions.get(sessionID)?.info
        if (target === undefined) {
          const sessionGetStarted = performance.now()
          target = yield* entry.client.session.get({
            sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
          })
          sessionGetDuration = performance.now() - sessionGetStarted
          setSessionInfo(entry, target)
        }
        const infoByID = sessionInfo(entry)
        const rootID = sessionRootID(target, infoByID)
        entry.selectedRootIDs.add(rootID)
        const family = Array.from(infoByID.values()).filter(
          (info) => sessionRootID(info, infoByID) === rootID,
        )
        yield* Effect.forEach(
          family,
          (info) => loadSessionState(entry, info, started, loadTimings),
          { concurrency: 4 },
        )
        const snapshotStarted = performance.now()
        yield* Effect.sync(() => emitSnapshot(entry))
        const snapshotDuration = performance.now() - snapshotStarted
        return {
          duration: performance.now() - started,
          sessionGetDuration,
          familySize: family.length,
          snapshotDuration,
          sessions: loadTimings,
        }
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
        setSessionInfo(entry, info)
        entry.selectedRootIDs.add(info.id)
        yield* loadSessionState(entry, info)
        emitSnapshot(entry)
        const record = entry.sessions.get(info.id)
        if (record?._tag !== "Loaded")
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "The new session could not be projected." }),
          )
        const session = sessionView(entry, record)
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
        if (text.trim() === "")
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Enter a prompt before sending." }),
          )
        return yield* openCode.submitPrompt(
          Schema.decodeUnknownSync(Session.ID)(sessionID),
          text.trim(),
        )
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
    const backgroundSession = (
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
        return yield* entry.client.session.background({
          sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID),
        })
      })
    const replyQuestion = (
      subscriptionID: string,
      sessionID: string,
      requestID: string,
      answers: ReadonlyArray<Question.Answer>,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        const decodedSessionID = Schema.decodeUnknownSync(Session.ID)(sessionID)
        const formID = questionFormID(requestID)
        const decodedRequestID = Schema.decodeUnknownSync(Question.ID)(requestID)
        if (formID === undefined) {
          yield* entry.client.question.reply({
            sessionID: decodedSessionID,
            requestID: decodedRequestID,
            answers,
          })
        } else {
          const form = yield* entry.client.form.get({ sessionID: decodedSessionID, formID })
          yield* entry.client.form.reply({
            sessionID: decodedSessionID,
            formID,
            answer: questionFormAnswer(form, answers),
          })
        }
        const record = entry.sessions.get(decodedSessionID)
        if (record?._tag !== "Loaded") return yield* Effect.void
        entry.sessions.set(decodedSessionID, {
          ...record,
          state: {
            ...record.state,
            questions: record.state.questions.filter(
              (request) => request.id !== decodedRequestID,
            ),
          },
        })
        publish(entry, decodedSessionID)
        return yield* Effect.void
      })
    const rejectQuestion = (
      subscriptionID: string,
      sessionID: string,
      requestID: string,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const subscription = subscriptions.get(subscriptionID)
        if (subscription === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project subscription is closed" }),
          )
        const { entry } = subscription
        const decodedSessionID = Schema.decodeUnknownSync(Session.ID)(sessionID)
        const formID = questionFormID(requestID)
        const decodedRequestID = Schema.decodeUnknownSync(Question.ID)(requestID)
        if (formID === undefined) {
          yield* entry.client.question.reject({
            sessionID: decodedSessionID,
            requestID: decodedRequestID,
          })
        } else {
          yield* entry.client.form.cancel({ sessionID: decodedSessionID, formID })
        }
        const record = entry.sessions.get(decodedSessionID)
        if (record?._tag !== "Loaded") return yield* Effect.void
        entry.sessions.set(decodedSessionID, {
          ...record,
          state: {
            ...record.state,
            questions: record.state.questions.filter(
              (request) => request.id !== decodedRequestID,
            ),
          },
        })
        publish(entry, decodedSessionID)
        return yield* Effect.void
      })
    return ProjectRegistry.of({
      list,
      resolve,
      open,
      close,
      selectSession,
      createSession,
      submitPrompt,
      replyQuestion,
      rejectQuestion,
      backgroundSession,
      interrupt,
    })
  }),
)
