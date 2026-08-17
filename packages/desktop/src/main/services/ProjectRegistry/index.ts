import {
  Location,
  Question,
  Session,
  SessionMessage,
  Project,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { Context, DateTime, Effect, Layer, Queue, Scope, Semaphore, Stream } from "effect"
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
  ProjectUpdate,
  SessionLoadTiming,
  SessionSelectionTiming,
} from "../../../shared/project"
import type { CreateSessionResult } from "../../../shared/project"
import {
  availableProjects,
  projectName,
  locationsEqual,
  locationKey,
  sessionRootID,
} from "../../../shared/domain/projectCatalog"
import { OpenCodeService } from "../OpenCodeService"

export class ProjectRegistryError extends Schema.TaggedErrorClass<ProjectRegistryError>()(
  "ProjectRegistryError",
  { message: Schema.String },
) {}

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
  readonly client: OpenCodeClient
  readonly sessions: Map<string, SessionRecord>
  readonly active: Set<Session.ID>
  notify: (update: ProjectUpdate) => void
  readonly selectedRootIDs: Set<string>
  ready: boolean
}

interface ProjectRegistryShape {
  readonly list: Effect.Effect<ReadonlyArray<ProjectCatalogEntry>, unknown>
  readonly resolve: (location: Location.Ref) => Effect.Effect<ProjectCatalogEntry, unknown>
  readonly open: (
    location: Location.Ref | undefined,
    notify: (location: Location.Ref, update: ProjectUpdate) => void,
  ) => Effect.Effect<Project.ID, unknown>
  readonly close: (location: Location.Ref) => Effect.Effect<void, unknown>
  readonly selectSession: (
    location: Location.Ref,
    sessionID: string,
  ) => Effect.Effect<SessionSelectionTiming, unknown>
  readonly createSession: (location: Location.Ref) => Effect.Effect<CreateSessionResult, unknown>
  readonly replyQuestion: (
    sessionID: string,
    requestID: string,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, unknown>
  readonly rejectQuestion: (sessionID: string, requestID: string) => Effect.Effect<void, unknown>
}

export class ProjectRegistry extends Context.Service<ProjectRegistry, ProjectRegistryShape>()(
  "HydraCode/ProjectRegistry",
) {}

const emit = (entry: Entry, update: ProjectUpdate) => {
  entry.notify(update)
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
const sessionMetadata = (entry: Entry) =>
  Array.from(entry.sessions.values())
    .map((record) => record.info)
    .filter((info) => locationsEqual(info.location, entry.location))

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
    execution: state.execution,
    messages: state.messages,
    pendingPrompts: Array.from(state.pending, ([id, item]) =>
      item.type === "user"
        ? [
            {
              id: Schema.decodeUnknownSync(SessionMessage.ID)(id),
              text: item.payload.text,
              delivery: item.delivery,
            },
          ]
        : [],
    ).flat(),
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
    const events = yield* Queue.unbounded<OpenCodeEvent>()
    const eventStreamLock = yield* Semaphore.make(1)
    let eventStreamStarted = false
    let serverConnected = false
    const emitSessions = (entry: Entry) =>
      emit(entry, {
        _tag: "Sessions",
        projectID: entry.project.id,
        sessions: sessionMetadata(entry),
        activeSessionIDs: Array.from(entry.active),
      })

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
        entry.active.delete(Schema.decodeUnknownSync(Session.ID)(sessionID))
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
        const [messages, questions, forms, inbox] = yield* Effect.all(
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
            entry.client.session.inbox.list({ sessionID: info.id }),
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
          state: initializeSessionLogState(
            info.id,
            messages,
            sequence,
            [...questions, ...formQuestions],
            new Map(inbox.map((item) => [item.id, item])),
          ),
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
          if (info.projectID !== entry.project.id || !locationsEqual(info.location, entry.location))
            return entry.sessions.has(info.id) ? removeSession(entry, info.id) : Effect.void
          setSessionInfo(entry, info)
          if (!isSelected(entry, info)) {
            if (entry.ready)
              emit(entry, {
                _tag: "Info",
                projectID: entry.project.id,
                session: info,
                active: entry.active.has(info.id),
              })
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
        for (const id of Object.keys(active))
          entry.active.add(Schema.decodeUnknownSync(Session.ID)(id))
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
        if (entry.ready) emitSessions(entry)
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
          yield* reconcileSessions(entry)
          return
        }
        const eventSessionID = sessionIDFromEvent(event)
        if (eventSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(eventSessionID)
        const known = entry.sessions.has(sessionID)
        const belongsToLocation =
          known ||
          (event.location !== undefined && locationsEqual(event.location, entry.location)) ||
          (event.location === undefined &&
            ((event.type === "session.created" && event.data.projectID === entry.project.id) ||
              (event.type === "session.moved" && event.data.projectID === entry.project.id)))
        if (!belongsToLocation) return
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

    const watchServer = (client: OpenCodeClient) => {
      const consume = client.event
        .subscribe()
        .pipe(Stream.runForEach((event) => Queue.offer(events, event).pipe(Effect.asVoid)))
      const loop: Effect.Effect<never> = consume.pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("OpenCode event stream disconnected", cause)
            yield* Effect.sleep("500 millis")
          }),
        ),
        Effect.andThen(Effect.suspend(() => loop)),
      )
      return loop
    }

    const processEvents = Effect.forever(
      Queue.take(events).pipe(
        Effect.flatMap((event) => {
          if (event.type === "server.connected" && !serverConnected) {
            serverConnected = true
            return Effect.void
          }
          return Effect.forEach(
            Array.from(entries.values()),
            (entry) =>
              processEvent(entry, event).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Could not process OpenCode event", cause),
                ),
              ),
            { discard: true },
          )
        }),
      ),
    )

    const startServerEvents = (client: OpenCodeClient) =>
      eventStreamLock.withPermits(1)(
        Effect.gen(function* () {
          if (eventStreamStarted) return
          yield* Effect.forkIn(watchServer(client), scope)
          yield* Effect.forkIn(processEvents, scope)
          eventStreamStarted = true
        }),
      )

    const open = (
      location: Location.Ref | undefined,
      notify: (location: Location.Ref, update: ProjectUpdate) => void,
    ): Effect.Effect<Project.ID, unknown> =>
      Effect.gen(function* () {
        const client = yield* openCode.client
        yield* startServerEvents(client)
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
        const project: ProjectDetails = {
          id: current.id,
          canonical: current.canonical,
        }
        const resolvedLocation = Location.Ref.make({
          directory: location?.directory ?? current.directory,
          ...(location?.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
        })
        const key = `${current.id}:${locationKey(resolvedLocation)}`
        let entry = entries.get(key)
        if (entry === undefined) {
          entry = {
            project,
            location: resolvedLocation,
            client,
            sessions: new Map(),
            active: new Set(),
            selectedRootIDs: new Set(),
            notify: (update) => notify(resolvedLocation, update),
            ready: true,
          }
        } else {
          entry.project = project
          entry.notify = (update) => notify(resolvedLocation, update)
        }
        entries.set(key, entry)
        return current.id
      })
    const close = (location: Location.Ref): Effect.Effect<void, unknown> =>
      Effect.sync(() => {
        const found = Array.from(entries.entries()).find(([, entry]) =>
          locationsEqual(entry.location, location),
        )
        if (found === undefined) return
        const [key] = found
        entries.delete(key)
      })
    const selectSession = (
      location: Location.Ref,
      sessionID: string,
    ): Effect.Effect<SessionSelectionTiming, unknown> =>
      Effect.gen(function* () {
        const started = performance.now()
        let sessionGetDuration = 0
        const loadTimings: Array<SessionLoadTiming> = []
        const entry = Array.from(entries.values()).find((candidate) =>
          locationsEqual(candidate.location, location),
        )
        if (entry === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project location is closed" }),
          )
        const [page, active] = yield* Effect.all(
          [listSessions(entry, location), entry.client.session.active()],
          { concurrency: "unbounded" },
        )
        entry.active.clear()
        for (const id of Object.keys(active))
          entry.active.add(Schema.decodeUnknownSync(Session.ID)(id))
        for (const info of page.data) setSessionInfo(entry, info)
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
        yield* Effect.sync(() => emitSessions(entry))
        const snapshotDuration = performance.now() - snapshotStarted
        return {
          duration: performance.now() - started,
          sessionGetDuration,
          familySize: family.length,
          snapshotDuration,
          sessions: loadTimings,
        }
      })
    const createSession = (location: Location.Ref): Effect.Effect<CreateSessionResult, unknown> =>
      Effect.gen(function* () {
        const entry = Array.from(entries.values()).find((candidate) =>
          locationsEqual(candidate.location, location),
        )
        if (entry === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Project location is closed" }),
          )
        const info = yield* entry.client.session.create({
          location,
        })
        setSessionInfo(entry, info)
        entry.selectedRootIDs.add(info.id)
        yield* loadSessionState(entry, info)
        const record = entry.sessions.get(info.id)
        if (record?._tag !== "Loaded")
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "The new session could not be projected." }),
          )
        const session = sessionView(entry, record)
        return { _tag: "Success", session } as const
      })
    const replyQuestion = (
      sessionID: string,
      requestID: string,
      answers: ReadonlyArray<Question.Answer>,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const decodedSessionID = Schema.decodeUnknownSync(Session.ID)(sessionID)
        const entry = Array.from(entries.values()).find((candidate) =>
          candidate.sessions.has(decodedSessionID),
        )
        if (entry === undefined)
          return yield* Effect.fail(new ProjectRegistryError({ message: "Session is not open" }))
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
            questions: record.state.questions.filter((request) => request.id !== decodedRequestID),
          },
        })
        publish(entry, decodedSessionID)
        return yield* Effect.void
      })
    const rejectQuestion = (sessionID: string, requestID: string): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        const decodedSessionID = Schema.decodeUnknownSync(Session.ID)(sessionID)
        const entry = Array.from(entries.values()).find((candidate) =>
          candidate.sessions.has(decodedSessionID),
        )
        if (entry === undefined)
          return yield* Effect.fail(new ProjectRegistryError({ message: "Session is not open" }))
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
            questions: record.state.questions.filter((request) => request.id !== decodedRequestID),
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
      replyQuestion,
      rejectQuestion,
    })
  }),
)
