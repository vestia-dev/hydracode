import {
  Location,
  Session,
  SessionMessage,
  Project,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode-ai/client/effect"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { Schema } from "effect"
import { performance } from "node:perf_hooks"
import {
  reduceSessionLog,
  initializeSessionLogState,
  questionFromForm,
  sessionIDFromEvent,
  type SessionLogState,
} from "../../../shared/domain/sessionLog"
import type {
  ProjectSession,
  ProjectUpdate,
  SessionLoadTiming,
  SessionSelectionTiming,
} from "../../../shared/project"
import { locationsEqual, locationKey, sessionRootID } from "../../../shared/domain/projectCatalog"
import { OpenCodeService } from "../OpenCodeService"
import { OpenCodeEventService } from "../OpenCodeEventService"

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
  readonly projectID: Project.ID
  readonly location: Location.Ref
  notify: (update: ProjectUpdate) => void
}

interface ProjectRegistryShape {
  readonly watch: (
    projectID: Project.ID,
    location: Location.Ref,
    notify: (location: Location.Ref, update: ProjectUpdate) => void,
  ) => Effect.Effect<void, unknown>
  readonly selectSession: (sessionID: Session.ID) => Effect.Effect<SessionSelectionTiming, unknown>
}

export class ProjectRegistry extends Context.Service<ProjectRegistry, ProjectRegistryShape>()(
  "HydraCode/ProjectRegistry",
) {}

const emit = (entry: Entry, update: ProjectUpdate) => {
  entry.notify(update)
}
const sessionInfo = (sessions: ReadonlyMap<string, SessionRecord>) =>
  new Map(Array.from(sessions, ([id, record]) => [id, record.info] as const))
const setSessionInfo = (sessions: Map<string, SessionRecord>, info: Session.Info) => {
  const current = sessions.get(info.id)
  sessions.set(
    info.id,
    current?._tag === "Loaded"
      ? { _tag: "Loaded", info, state: current.state }
      : { _tag: "Metadata", info },
  )
}
const sessionMetadata = (entry: Entry, sessions: ReadonlyMap<string, SessionRecord>) =>
  Array.from(sessions.values())
    .map((record) => record.info)
    .filter(
      (info) => info.projectID === entry.projectID && locationsEqual(info.location, entry.location),
    )

const sessionView = (
  { info, state }: Extract<SessionRecord, { readonly _tag: "Loaded" }>,
  activeSessionIDs: ReadonlySet<Session.ID>,
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
      activeSessionIDs.has(info.id),
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
const isSelected = (
  session: Session.Info,
  sessions: ReadonlyMap<string, SessionRecord>,
  selectedRootIDs: ReadonlySet<string>,
) => selectedRootIDs.has(sessionRootID(session, sessionInfo(sessions)))

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

const listSessions = (client: OpenCodeClient, entry: Entry, location: Location.Ref) =>
  client.session.list({
    project: entry.projectID,
    directory: location.directory,
    ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
    limit: 50,
    order: "desc",
  })

export const ProjectRegistryLive = Layer.effect(
  ProjectRegistry,
  Effect.gen(function* () {
    const openCode = yield* OpenCodeService
    const openCodeEvents = yield* OpenCodeEventService
    const entries = new Map<string, Entry>()
    const sessions = new Map<string, SessionRecord>()
    const activeSessionIDs = new Set<Session.ID>()
    const selectedRootIDs = new Set<string>()
    let serverConnected = false
    const emitSessions = (entry: Entry) =>
      emit(entry, {
        _tag: "Sessions",
        projectID: entry.projectID,
        sessions: sessionMetadata(entry, sessions),
        activeSessionIDs: Array.from(activeSessionIDs),
      })

    const removeSession = (entry: Entry, sessionID: Session.ID, removeActive = false) =>
      Effect.sync(() => {
        sessions.delete(sessionID)
        if (removeActive) activeSessionIDs.delete(sessionID)
        emit(entry, { _tag: "Removed", projectID: entry.projectID, sessionID })
      })

    const publish = (entry: Entry, sessionID: string) => {
      const record = sessions.get(sessionID)
      if (record?._tag !== "Loaded") return
      const next = sessionView(record, activeSessionIDs)
      emit(entry, { _tag: "Session", projectID: entry.projectID, session: next })
    }

    const loadSessionState = (
      entry: Entry,
      info: Session.Info,
      selectionStarted?: number,
      timings?: Array<SessionLoadTiming>,
    ) =>
      Effect.gen(function* () {
        const started = performance.now()
        const client = yield* openCode.client
        setSessionInfo(sessions, info)
        const watermarkStarted = performance.now()
        const sequence = yield* captureWatermark(client, info.id)
        const watermarkDuration = performance.now() - watermarkStarted
        let contextDuration = 0
        let questionsDuration = 0
        let formsDuration = 0
        const contextStarted = performance.now()
        const questionsStarted = performance.now()
        const formsStarted = performance.now()
        const [messages, questions, forms, inbox] = yield* Effect.all(
          [
            client.session.context({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  contextDuration = performance.now() - contextStarted
                }),
              ),
            ),
            client.question.list({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  questionsDuration = performance.now() - questionsStarted
                }),
              ),
            ),
            client.form.list({ sessionID: info.id }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  formsDuration = performance.now() - formsStarted
                }),
              ),
            ),
            client.session.inbox.list({ sessionID: info.id }),
          ],
          { concurrency: "unbounded" },
        )
        const formQuestions = forms.flatMap((form) => {
          const question = questionFromForm(form)
          return question === undefined ? [] : [question]
        })
        const stateBuildStarted = performance.now()
        sessions.set(info.id, {
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
      openCode.client.pipe(
        Effect.flatMap((client) => client.session.get({ sessionID })),
        Effect.flatMap((info) => {
          const previous = sessions.get(info.id)?.info
          setSessionInfo(sessions, info)
          if (
            info.projectID !== entry.projectID ||
            !locationsEqual(info.location, entry.location)
          ) {
            if (
              previous?.projectID === entry.projectID &&
              locationsEqual(previous.location, entry.location)
            )
              emit(entry, {
                _tag: "Removed",
                projectID: entry.projectID,
                sessionID: info.id,
              })
            return Effect.void
          }
          if (!isSelected(info, sessions, selectedRootIDs)) {
            emit(entry, {
              _tag: "Info",
              projectID: entry.projectID,
              session: info,
              active: activeSessionIDs.has(info.id),
            })
            return Effect.void
          }
          const record = sessions.get(info.id)
          if (record?._tag !== "Loaded") return loadSessionState(entry, info)
          const next = sessionView(record, activeSessionIDs)
          emit(entry, { _tag: "Session", projectID: entry.projectID, session: next })
          return Effect.void
        }),
      )

    const reloadSessionState = (entry: Entry, sessionID: Session.ID) =>
      openCode.client.pipe(
        Effect.flatMap((client) => client.session.get({ sessionID })),
        Effect.flatMap((info) => loadSessionState(entry, info)),
      )

    const apply = (entry: Entry, event: OpenCodeEvent): Effect.Effect<void, ProjectRegistryError> =>
      Effect.gen(function* () {
        const eventSessionID = sessionIDFromEvent(event)
        if (eventSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(eventSessionID)
        const current = sessions.get(sessionID)
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
        if (event.type === "session.execution.started") activeSessionIDs.add(sessionID)
        if (
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.interrupted" ||
          event.type === "session.execution.failed"
        )
          activeSessionIDs.delete(sessionID)
        if (reduction.status === "missing-input") {
          const client = yield* openCode.client
          const message = yield* client.session
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
          sessions.set(sessionID, {
            ...current,
            state: {
              ...reduction.state,
              messages: [
                ...reduction.state.messages.filter((item) => item.id !== message.id),
                message,
              ],
            },
          })
        } else sessions.set(sessionID, { ...current, state: reduction.state })
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
        const client = yield* openCode.client
        const [page, active] = yield* Effect.all(
          [listSessions(client, entry, entry.location), client.session.active()],
          { concurrency: "unbounded" },
        )
        activeSessionIDs.clear()
        for (const id of Object.keys(active))
          activeSessionIDs.add(Schema.decodeUnknownSync(Session.ID)(id))
        const availableIDs = new Set<string>(page.data.map((info) => info.id))
        for (const rootID of selectedRootIDs) {
          const root = sessions.get(rootID)?.info
          if (
            root?.projectID === entry.projectID &&
            locationsEqual(root.location, entry.location) &&
            !availableIDs.has(rootID)
          )
            selectedRootIDs.delete(rootID)
        }
        for (const { info } of sessions.values()) {
          if (info.projectID !== entry.projectID || !locationsEqual(info.location, entry.location))
            continue
          const sessionID = info.id
          if (!availableIDs.has(sessionID)) yield* removeSession(entry, sessionID)
        }
        for (const info of page.data) setSessionInfo(sessions, info)
        const selected = page.data.filter((info) => isSelected(info, sessions, selectedRootIDs))
        yield* Effect.forEach(selected, (info) => loadSessionState(entry, info), {
          concurrency: 4,
        })
        emitSessions(entry)
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
          if (event.data.projectID !== entry.projectID) return
          yield* reconcileSessions(entry)
          return
        }
        const eventSessionID = sessionIDFromEvent(event)
        if (eventSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(eventSessionID)
        if (event.type === "session.deleted") {
          yield* removeSession(entry, sessionID, true)
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
        const record = sessions.get(sessionID)
        if (
          record?._tag !== "Loaded" ||
          record.info.projectID !== entry.projectID ||
          !locationsEqual(record.info.location, entry.location)
        )
          return
        yield* apply(entry, event)
      }).pipe(
        Effect.mapError(
          () =>
            new ProjectRegistryError({
              message: `Could not reconcile project ${entry.projectID}`,
            }),
        ),
      )

    const entriesForEvent = (event: OpenCodeEvent): ReadonlyArray<Entry> => {
      const openEntries = Array.from(entries.values())
      if (event.type === "server.connected" || event.type === "worktree.updated") return openEntries
      const eventSessionID = sessionIDFromEvent(event)
      if (eventSessionID === undefined) return []
      const candidates = new Set<Entry>()
      const current = sessions.get(eventSessionID)?.info
      if (current !== undefined) {
        const entry = openEntries.find(
          (candidate) =>
            candidate.projectID === current.projectID &&
            locationsEqual(candidate.location, current.location),
        )
        if (entry !== undefined) candidates.add(entry)
      }
      if (event.location !== undefined) {
        for (const entry of openEntries) {
          if (locationsEqual(entry.location, event.location)) candidates.add(entry)
        }
      } else if (event.type === "session.created" || event.type === "session.moved") {
        for (const entry of openEntries) {
          if (entry.projectID === event.data.projectID) candidates.add(entry)
        }
      }
      return Array.from(candidates)
    }

    const processEvents = (event: OpenCodeEvent) => {
      if (event.type === "server.connected" && !serverConnected) {
        serverConnected = true
        return Effect.void
      }
      return Effect.forEach(
        entriesForEvent(event),
        (entry) =>
          processEvent(entry, event).pipe(
            Effect.catch((cause) => Effect.logWarning("Could not process OpenCode event", cause)),
          ),
        { discard: true },
      )
    }

    const watch = (
      projectID: Project.ID,
      location: Location.Ref,
      notify: (location: Location.Ref, update: ProjectUpdate) => void,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        yield* openCodeEvents.subscribe(processEvents)
        const key = `${projectID}:${locationKey(location)}`
        let entry = entries.get(key)
        if (entry === undefined) {
          entry = {
            projectID,
            location,
            notify: (update) => notify(location, update),
          }
        } else {
          entry.notify = (update) => notify(location, update)
        }
        entries.set(key, entry)
      })
    const selectSession = (sessionID: Session.ID): Effect.Effect<SessionSelectionTiming, unknown> =>
      Effect.gen(function* () {
        const started = performance.now()
        const loadTimings: Array<SessionLoadTiming> = []
        const client = yield* openCode.client
        const sessionGetStarted = performance.now()
        const target = yield* client.session.get({ sessionID })
        const sessionGetDuration = performance.now() - sessionGetStarted
        const entry = Array.from(entries.values()).find(
          (candidate) =>
            candidate.projectID === target.projectID &&
            locationsEqual(candidate.location, target.location),
        )
        if (entry === undefined)
          return yield* Effect.fail(
            new ProjectRegistryError({ message: "Session location is closed" }),
          )
        const [page, active] = yield* Effect.all(
          [listSessions(client, entry, target.location), client.session.active()],
          { concurrency: "unbounded" },
        )
        activeSessionIDs.clear()
        for (const id of Object.keys(active))
          activeSessionIDs.add(Schema.decodeUnknownSync(Session.ID)(id))
        for (const info of page.data) setSessionInfo(sessions, info)
        setSessionInfo(sessions, target)
        const infoByID = sessionInfo(sessions)
        const rootID = sessionRootID(target, infoByID)
        selectedRootIDs.add(rootID)
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
    return ProjectRegistry.of({
      watch,
      selectSession,
    })
  }),
)
