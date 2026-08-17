import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import { DateTime, Effect, Fiber, Option, Schema } from "effect"
import {
  AbsolutePath,
  Location,
  Project,
  Session,
  SessionMessage,
  type OpenCodeEvent,
  type Question,
} from "@opencode-ai/client/effect"
import { AppRuntime } from "../runtime"
import { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { ProjectView, SessionView } from "../services/OpenCodeGateway"
import { buildSessionGraph } from "../domain/sessionGraph"
import {
  createProvisionalSessionID,
  applyOptimisticPrompts,
  type OptimisticPrompt,
} from "../domain/optimisticPrompts"
import type { ProjectCatalogEntry, SessionSnapshot } from "../../../shared/project"
import type { PendingPrompt } from "../services/OpenCodeGateway"
import {
  createSessionView,
  openProjectState,
  type OpenLocationState,
} from "../domain/projectLocationState"
import { restoreApplicationState } from "../domain/applicationState"
import { markStartup, recordStartupMeasure } from "../startupTiming"
import {
  locationKey,
  mergeProjectCatalogEntry,
  sessionRootID,
} from "../../../shared/domain/projectCatalog"
import {
  initializeSessionLogState,
  questionFromForm,
  reduceSessionLog,
  sessionIDFromEvent,
  type SessionLogState,
} from "../../../shared/domain/sessionLog"

export type AvailableProjectsState =
  | { readonly _tag: "Loading" }
  | {
      readonly _tag: "Ready"
      readonly projects: ReadonlyArray<ProjectCatalogEntry>
    }
  | { readonly _tag: "Error"; readonly message: string }

interface LocationConnection {
  readonly id: string
  readonly fiber: Fiber.Fiber<unknown, unknown>
}

interface SessionRecord {
  readonly info: Session.Info
  readonly state: SessionLogState
}

function pendingPrompt(session: SessionView, text: string): OptimisticPrompt {
  return {
    id: `optimistic-prompt:${crypto.randomUUID()}`,
    text,
    created: Date.now(),
    baselineMessageIDs: Array.from(
      new Set(session.authoritativeGraph.nodes.flatMap((node) => node.provenance.messageIDs)),
    ),
  }
}

function mapLocationSnapshot(
  current: OpenLocationState,
  transform: (snapshot: ProjectView) => ProjectView,
): OpenLocationState {
  if (current.status === "opening" || current.snapshot === undefined) return current
  return { ...current, snapshot: transform(current.snapshot) }
}

function withPrompts(
  session: SessionView,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt>,
): SessionView {
  return {
    ...session,
    optimisticPrompts,
    graph: applyOptimisticPrompts(session.authoritativeGraph, optimisticPrompts),
  }
}

export function useProjectController() {
  const [activeLocationKey, setActiveLocationKey] = useState<string | null>(null)
  const activeLocationKeyRef = useRef(activeLocationKey)
  activeLocationKeyRef.current = activeLocationKey
  const [openLocations, setOpenLocations] = useState<ReadonlyMap<string, OpenLocationState>>(
    () => new Map(),
  )
  const locationsRef = useRef(openLocations)
  locationsRef.current = openLocations
  const [sessions, setSessions] = useState<ReadonlyMap<Session.ID, SessionView>>(() => new Map())
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const sessionRecords = useRef(new Map<Session.ID, SessionRecord>())
  const sessionInfos = useRef(new Map<Session.ID, Session.Info>())
  const activeSessionIDs = useRef(new Set<Session.ID>())
  const loadingSessionIDs = useRef(new Set<Session.ID>())
  const bufferedEvents = useRef(new Map<Session.ID, Array<OpenCodeEvent>>())
  const eventChain = useRef(Promise.resolve())
  const [availableProjects, setAvailableProjects] = useState<AvailableProjectsState>({
    _tag: "Loading",
  })
  const [restoredProjectUIStates, setRestoredProjectUIStates] = useState<
    ReadonlyArray<import("../../../shared/applicationState").ProjectUIState>
  >([])
  const [initialStateResolved, setInitialStateResolved] = useState(false)
  const [landingError, setLandingError] = useState<string | null>(null)
  const selectionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const availableProjectsFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const locationConnections = useRef(new Map<string, LocationConnection>())

  const persistLocationSelection = useCallback(
    (projects: ReadonlyMap<string, OpenLocationState>, activeID: string | null) => {
      const locationsToPersist = Array.from(projects.values()).filter(
        (location) => location.projectID !== Project.ID.global,
      )
      AppRuntime.runFork(
        DesktopBridge.use((desktop) =>
          desktop.saveProjectSelection({
            openLocations: locationsToPersist.map((location) => ({
              projectID: location.projectID,
              location: location.location,
            })),
            activeLocationKey:
              activeID !== null &&
              locationsToPersist.some((location) => location.locationKey === activeID)
                ? activeID
                : locationsToPersist[0] === undefined
                  ? null
                  : locationsToPersist[0].locationKey,
          }),
        ).pipe(Effect.catch((error) => Effect.sync(() => setLandingError(error.message)))),
      )
    },
    [],
  )

  const updateProject = useCallback(
    (locationKeyValue: string, update: (state: OpenLocationState) => OpenLocationState) => {
      const state = locationsRef.current.get(locationKeyValue)
      if (state === undefined) return
      const next = new Map(locationsRef.current)
      next.set(locationKeyValue, update(state))
      locationsRef.current = next
      setOpenLocations(next)
    },
    [],
  )

  const startupLocationKey = useRef<string | null>(null)

  const publishSession = useCallback((sessionID: Session.ID) => {
    const record = sessionRecords.current.get(sessionID)
    if (record === undefined) return
    const active =
      record.state.execution._tag === "Running" ||
      record.state.execution._tag === "Retrying" ||
      activeSessionIDs.current.has(sessionID)
    const previous = sessionsRef.current.get(sessionID)
    const view = createSessionView(record.info, record.state, active, previous)
    const next = new Map(sessionsRef.current).set(sessionID, view)
    sessionsRef.current = next
    startTransition(() => setSessions(next))
  }, [])

  const updateSessionView = useCallback(
    (sessionID: Session.ID, update: (session: SessionView) => SessionView) => {
      const current = sessionsRef.current.get(sessionID)
      if (current === undefined) return
      const next = new Map(sessionsRef.current).set(sessionID, update(current))
      sessionsRef.current = next
      setSessions(next)
    },
    [],
  )

  const installSnapshot = useCallback(
    (snapshot: SessionSnapshot, state: SessionLogState) => {
      sessionInfos.current.set(snapshot.info.id, snapshot.info)
      sessionRecords.current.set(snapshot.info.id, { info: snapshot.info, state })
      publishSession(snapshot.info.id)
    },
    [publishSession],
  )

  const loadSessionState = useCallback(
    (sessionID: Session.ID) =>
      DesktopBridge.use((desktop) =>
        Effect.gen(function* () {
          if (loadingSessionIDs.current.has(sessionID)) {
            while (loadingSessionIDs.current.has(sessionID)) yield* Effect.sleep("10 millis")
            const loaded = sessionRecords.current.get(sessionID)
            if (loaded !== undefined) return loaded.info
          }
          loadingSessionIDs.current.add(sessionID)
          while (true) {
            const snapshot = yield* desktop.loadSessionSnapshot({ sessionID })
            const questions = [
              ...snapshot.questions,
              ...snapshot.forms.flatMap((form) => {
                const question = questionFromForm(form)
                return question === undefined ? [] : [question]
              }),
            ]
            let state = initializeSessionLogState(
              sessionID,
              snapshot.messages,
              snapshot.durableSeq,
              questions,
              new Map(snapshot.inbox.map((item) => [item.id, item])),
            )
            const pending = bufferedEvents.current.get(sessionID) ?? []
            bufferedEvents.current.delete(sessionID)
            let reload = false
            for (let index = 0; index < pending.length; index += 1) {
              const event = pending[index]!
              const reduction = reduceSessionLog(state, event)
              if (reduction.status === "gap") {
                bufferedEvents.current.set(sessionID, pending.slice(index))
                reload = true
                break
              }
              if (reduction.status === "duplicate" || reduction.status === "ignored") continue
              state = reduction.state
              if (reduction.status === "missing-input") {
                const message = yield* desktop.getSessionMessage({
                  sessionID,
                  messageID: Schema.decodeUnknownSync(SessionMessage.ID)(reduction.inputID),
                })
                state = {
                  ...state,
                  messages: [...state.messages.filter((item) => item.id !== message.id), message],
                }
              }
            }
            if (reload) continue
            installSnapshot(snapshot, state)
            return snapshot.info
          }
        }).pipe(Effect.ensuring(Effect.sync(() => loadingSessionIDs.current.delete(sessionID)))),
      ),
    [installSnapshot],
  )

  const reconcileOpenLocations = useCallback(
    () =>
      DesktopBridge.use((desktop) =>
        Effect.gen(function* () {
          const active = yield* desktop.listActiveSessions
          activeSessionIDs.current = new Set(active)
          yield* Effect.forEach(
            Array.from(locationsRef.current.entries()),
            ([key, current]) =>
              desktop
                .listProjectSessions({ projectID: current.projectID, location: current.location })
                .pipe(
                  Effect.tap((infos) =>
                    Effect.sync(() => {
                      for (const info of infos) sessionInfos.current.set(info.id, info)
                      if (current.snapshot !== undefined)
                        updateProject(key, (value) =>
                          openProjectState(
                            value,
                            current.snapshot!.project,
                            current.projectID,
                            infos,
                            active,
                          ),
                        )
                    }),
                  ),
                ),
            { concurrency: 4, discard: true },
          )
          for (const sessionID of sessionRecords.current.keys()) publishSession(sessionID)
        }),
      ),
    [publishSession, updateProject],
  )

  const handleOpenCodeEvent = useCallback(
    (event: OpenCodeEvent) =>
      Effect.gen(function* () {
        if (event.type === "server.connected") {
          yield* reconcileOpenLocations()
          yield* Effect.forEach(sessionRecords.current.keys(), loadSessionState, {
            concurrency: 4,
            discard: true,
          })
          return
        }
        if (event.type === "worktree.updated") {
          yield* reconcileOpenLocations()
          return
        }
        const rawSessionID = sessionIDFromEvent(event)
        if (rawSessionID === undefined) return
        const sessionID = Schema.decodeUnknownSync(Session.ID)(rawSessionID)
        if (event.type === "session.deleted") {
          sessionInfos.current.delete(sessionID)
          sessionRecords.current.delete(sessionID)
          activeSessionIDs.current.delete(sessionID)
          const next = new Map(sessionsRef.current)
          next.delete(sessionID)
          sessionsRef.current = next
          setSessions(next)
          yield* reconcileOpenLocations()
          return
        }
        if (
          event.type === "session.created" ||
          event.type === "session.renamed" ||
          event.type === "session.moved" ||
          event.type === "session.forked"
        ) {
          yield* reconcileOpenLocations()
          if (sessionRecords.current.has(sessionID)) yield* loadSessionState(sessionID)
          return
        }
        if (event.type === "session.execution.started") activeSessionIDs.current.add(sessionID)
        if (
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.interrupted" ||
          event.type === "session.execution.failed"
        )
          activeSessionIDs.current.delete(sessionID)
        const current = sessionRecords.current.get(sessionID)
        if (loadingSessionIDs.current.has(sessionID)) {
          const pending = bufferedEvents.current.get(sessionID) ?? []
          bufferedEvents.current.set(sessionID, [...pending, event])
          return
        }
        if (current === undefined) return
        const reduction = reduceSessionLog(current.state, event)
        if (reduction.status === "gap") {
          bufferedEvents.current.set(sessionID, [event])
          yield* loadSessionState(sessionID)
          return
        }
        if (reduction.status === "duplicate" || reduction.status === "ignored") return
        let state = reduction.state
        if (reduction.status === "missing-input") {
          const message = yield* DesktopBridge.use((desktop) =>
            desktop.getSessionMessage({
              sessionID,
              messageID: Schema.decodeUnknownSync(SessionMessage.ID)(reduction.inputID),
            }),
          )
          state = {
            ...state,
            messages: [...state.messages.filter((item) => item.id !== message.id), message],
          }
        }
        sessionRecords.current.set(sessionID, { ...current, state })
        publishSession(sessionID)
      }),
    [loadSessionState, publishSession, reconcileOpenLocations],
  )

  const startLocationConnection = useCallback(
    (
      key: string,
      project: ProjectCatalogEntry["project"],
      location: Location.Ref,
      onConnected?: () => void,
    ) => {
      const connectionID = crypto.randomUUID()
      const program = DesktopBridge.use((desktop) =>
        desktop.openProject({ location }).pipe(
          Effect.flatMap((projectID) =>
            Effect.all({
              projectID: Effect.succeed(projectID),
              sessions: desktop.listProjectSessions({ projectID, location }),
              activeIDs: desktop.listActiveSessions,
            }),
          ),
          Effect.tap(({ projectID, sessions: infos, activeIDs }) =>
            Effect.sync(() => {
              const started = performance.now()
              if (key === startupLocationKey.current)
                markStartup("project-open-received", { sessions: infos.length })
              updateProject(key, (current) =>
                openProjectState(current, project, projectID, infos, activeIDs),
              )
              for (const info of infos) sessionInfos.current.set(info.id, info)
              activeSessionIDs.current = new Set(activeIDs)
              recordStartupMeasure("project-open-projection", started, {
                locationKey: key,
                sessions: infos.length,
              })
              if (key === startupLocationKey.current) markStartup("project-open-projected")
              onConnected?.()
            }),
          ),
        ),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (locationConnections.current.get(key)?.id === connectionID)
              locationConnections.current.delete(key)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() =>
            updateProject(key, (current) => ({
              ...current,
              status: "error",
              error: error.message,
            })),
          ),
        ),
      )
      const fiber = AppRuntime.runFork(Effect.yieldNow.pipe(Effect.andThen(program)))
      locationConnections.current.set(key, { id: connectionID, fiber })
    },
    [updateProject],
  )

  const openLocation = useCallback(
    (
      project: ProjectCatalogEntry,
      persist = true,
      selectedLocation?: Location.Ref,
      activate = true,
    ) => {
      const projectID = project.project.id
      const location = selectedLocation ?? project.locations[0]?.ref
      if (location === undefined) return
      const key = locationKey(location)
      const existing = locationsRef.current.get(key)
      if (existing !== undefined) {
        if (activate) setActiveLocationKey(key)
        if (persist)
          persistLocationSelection(
            locationsRef.current,
            activate ? key : activeLocationKeyRef.current,
          )
        return
      }
      const state: OpenLocationState = {
        locationKey: key,
        projectID,
        location,
        status: "opening",
        snapshot: undefined,
        error: undefined,
        promptRetry: null,
        landingError: null,
      }
      locationsRef.current = new Map(locationsRef.current).set(key, state)
      setOpenLocations(locationsRef.current)
      if (activate) setActiveLocationKey(key)
      setLandingError(null)
      if (persist)
        persistLocationSelection(
          locationsRef.current,
          activate ? key : activeLocationKeyRef.current,
        )
      startLocationConnection(key, project.project, location, () => {
        if (key === startupLocationKey.current) markStartup("project-subscription-ready")
      })
    },
    [persistLocationSelection, startLocationConnection],
  )

  const ensureLocation = useCallback(
    (project: ProjectCatalogEntry, location: Location.Ref) =>
      openLocation(project, true, location, false),
    [openLocation],
  )

  const activateLocation = useCallback(
    (locationKeyValue: string) => {
      if (!locationsRef.current.has(locationKeyValue)) return
      setActiveLocationKey(locationKeyValue)
      persistLocationSelection(locationsRef.current, locationKeyValue)
    },
    [persistLocationSelection],
  )

  const closeLocation = useCallback(
    (locationKeyValue: string) => {
      const connection = locationConnections.current.get(locationKeyValue)
      locationConnections.current.delete(locationKeyValue)
      if (connection !== undefined) AppRuntime.runFork(Fiber.interrupt(connection.fiber))
      setOpenLocations((current) => {
        const next = new Map(current)
        next.delete(locationKeyValue)
        locationsRef.current = next
        setActiveLocationKey((active) => {
          const nextActive =
            active === locationKeyValue ? (next.keys().next().value ?? null) : active
          persistLocationSelection(next, nextActive)
          return nextActive
        })
        return next
      })
    },
    [persistLocationSelection],
  )

  const submitPrompt = useCallback(
    (
      _locationKeyValue: string,
      sessionID: SessionView["id"],
      text: string,
      delivery?: "queue" | "steer",
    ) =>
      Effect.gen(function* () {
        const session = sessionsRef.current.get(sessionID)
        if (session === undefined)
          return yield* new DesktopBridgeError({
            message: "HydraCode could not find this session.",
            cause: sessionID,
          })
        const prompt = pendingPrompt(session, text.trim())
        yield* Effect.sync(() =>
          updateSessionView(sessionID, (current) =>
            withPrompts(current, [...current.optimisticPrompts, prompt]),
          ),
        )
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({
            sessionID,
            text: prompt.text,
            delivery,
          }),
        ).pipe(
          Effect.tapError(() =>
            Effect.sync(() =>
              updateSessionView(sessionID, (current) =>
                withPrompts(
                  current,
                  current.optimisticPrompts.filter((pending) => pending.id !== prompt.id),
                ),
              ),
            ),
          ),
        )
      }),
    [updateSessionView],
  )

  const updateSessionInbox = useCallback(
    (
      _locationKeyValue: string,
      sessionID: SessionView["id"],
      inboxID: PendingPrompt["id"],
      action: "cancel" | "queue" | "steer",
    ) => DesktopBridge.use((desktop) => desktop.updateSessionInbox({ sessionID, inboxID, action })),
    [],
  )

  const selectSession = useCallback(
    (locationKeyValue: string, sessionID: string) =>
      Effect.gen(function* () {
        if (!locationsRef.current.has(locationKeyValue))
          return yield* new DesktopBridgeError({
            message: "HydraCode could not find this project location.",
            cause: locationKeyValue,
          })
        const id = Schema.decodeUnknownSync(Session.ID)(sessionID)
        const active = yield* DesktopBridge.use((desktop) => desktop.listActiveSessions)
        activeSessionIDs.current = new Set(active)
        const target = yield* loadSessionState(id)
        const rootID = Schema.decodeUnknownSync(Session.ID)(
          sessionRootID(target, sessionInfos.current),
        )
        const family = Array.from(sessionInfos.current.values()).filter(
          (info) => sessionRootID(info, sessionInfos.current) === rootID && info.id !== id,
        )
        yield* Effect.forEach(family, (info) => loadSessionState(info.id), {
          concurrency: 4,
          discard: true,
        })
        yield* Effect.sync(() =>
          updateProject(locationKeyValue, (current) => ({
            ...current,
            promptRetry: null,
          })),
        )
        return yield* Effect.void
      }),
    [loadSessionState, updateProject],
  )

  const createSession = useCallback(
    (
      locationKeyValue: string,
      text: string,
      selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
    ) =>
      Effect.gen(function* () {
        const currentSnapshot = locationsRef.current.get(locationKeyValue)?.snapshot
        if (currentSnapshot === undefined)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not ready to create a session.",
            cause: text,
          })
        const promptText = text.trim()
        const provisionalID = createProvisionalSessionID()
        const authoritativeGraph = buildSessionGraph([])
        const provisionalBase: SessionView = {
          id: provisionalID,
          location: currentSnapshot.location,
          created: Date.now(),
          title: "New session",
          active: false,
          execution: { _tag: "Idle" },
          questions: [],
          pendingPrompts: [],
          provisional: true,
          authoritativeGraph,
          optimisticPrompts: [],
          graph: authoritativeGraph,
        }
        const prompt = pendingPrompt(provisionalBase, promptText)
        yield* Effect.sync(() => {
          const nextSessions = new Map(sessionsRef.current).set(
            provisionalID,
            withPrompts(provisionalBase, [prompt]),
          )
          sessionsRef.current = nextSessions
          setSessions(nextSessions)
          updateProject(locationKeyValue, (current) => ({
            ...current,
            landingError: null,
            promptRetry: null,
          }))
          selectCreated?.(provisionalID)
        })
        const result = yield* DesktopBridge.use((desktop) =>
          desktop.createSession({ location: currentSnapshot.location }),
        ).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              selectCreated?.(undefined)
              const nextSessions = new Map(sessionsRef.current)
              nextSessions.delete(provisionalID)
              sessionsRef.current = nextSessions
              setSessions(nextSessions)
              updateProject(locationKeyValue, (current) => ({
                ...current,
                landingError: error.message,
              }))
            }),
          ),
        )
        const session = withPrompts(
          {
            ...provisionalBase,
            id: result.session.id,
            ...(result.session.parentID === undefined ? {} : { parentID: result.session.parentID }),
            location: result.session.location,
            created: DateTime.toEpochMillis(result.session.time.created),
            title: result.session.title ?? "Untitled session",
            provisional: false,
          },
          [prompt],
        )
        yield* Effect.sync(() => {
          selectCreated?.(session.id)
          const nextSessions = new Map(sessionsRef.current)
          nextSessions.delete(provisionalID)
          nextSessions.set(session.id, session)
          sessionsRef.current = nextSessions
          setSessions(nextSessions)
          sessionInfos.current.set(result.session.id, result.session)
          updateProject(locationKeyValue, (current) =>
            mapLocationSnapshot(current, (snapshot) => ({
              ...snapshot,
              recentSessions: [
                {
                  id: session.id,
                  created: session.created,
                  title: session.title,
                  active: session.active,
                },
                ...snapshot.recentSessions.filter((item) => item.id !== session.id),
              ],
            })),
          )
        })
        yield* selectSession(locationKeyValue, result.session.id)
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({
            sessionID: session.id,
            text: promptText,
          }),
        ).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() => {
                updateSessionView(session.id, (current) => withPrompts(current, []))
                updateProject(locationKeyValue, (current) => ({
                  ...current,
                  promptRetry: {
                    sessionID: session.id,
                    text: promptText,
                    message: error.message,
                  },
                }))
              }),
            onSuccess: () => Effect.void,
          }),
        )
      }),
    [selectSession, updateProject, updateSessionView],
  )

  const openGlobalProject = useCallback(
    (text: string) => {
      const projectID = Project.ID.global
      const location = Location.Ref.make({ directory: AbsolutePath.make("/") })
      const key = locationKey(location)
      const existing = locationsRef.current.get(key)
      if (existing !== undefined) {
        setActiveLocationKey(key)
        return createSession(key, text)
      }
      const state: OpenLocationState = {
        locationKey: key,
        projectID,
        location,
        status: "opening",
        snapshot: undefined,
        error: undefined,
        promptRetry: null,
        landingError: null,
      }
      locationsRef.current = new Map(locationsRef.current).set(key, state)
      setOpenLocations(locationsRef.current)
      setActiveLocationKey(key)
      setLandingError(null)
      startLocationConnection(
        key,
        { id: projectID, canonical: AbsolutePath.make("/") },
        location,
        () => {
          AppRuntime.runFork(
            createSession(key, text, (sessionID) => {
              if (sessionID === undefined) return
              updateProject(key, (current) => ({
                ...current,
                requestedSessionID: sessionID,
              }))
            }).pipe(Effect.catch((error) => Effect.sync(() => setLandingError(error.message)))),
          )
        },
      )
      return Effect.void
    },
    [createSession, startLocationConnection, updateProject],
  )

  const interruptSession = useCallback(
    (_locationKeyValue: string, sessionID: SessionView["id"]) =>
      DesktopBridge.use((desktop) => desktop.interrupt({ sessionID })),
    [],
  )

  const backgroundSession = useCallback(
    (_locationKeyValue: string, sessionID: SessionView["id"]) =>
      DesktopBridge.use((desktop) => desktop.backgroundSession({ sessionID })),
    [],
  )

  const replyQuestion = useCallback(
    (
      _locationKeyValue: string,
      request: Question.Request,
      answers: ReadonlyArray<Question.Answer>,
    ) =>
      DesktopBridge.use((desktop) =>
        desktop.replyQuestion({
          sessionID: request.sessionID,
          requestID: request.id,
          answers,
        }),
      ),
    [],
  )

  const rejectQuestion = useCallback(
    (_locationKeyValue: string, request: Question.Request) =>
      DesktopBridge.use((desktop) =>
        desktop.rejectQuestion({
          sessionID: request.sessionID,
          requestID: request.id,
        }),
      ),
    [],
  )

  const loadProjects = useCallback(() => {
    if (availableProjectsFiber.current !== null)
      AppRuntime.runFork(Fiber.interrupt(availableProjectsFiber.current))
    setAvailableProjects({ _tag: "Loading" })
    markStartup("project-catalog-load-start")
    markStartup("application-state-load-start")
    availableProjectsFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) =>
        Effect.all([desktop.listProjects, desktop.loadApplicationState]),
      ).pipe(
        Effect.tap(([projects, state]) =>
          Effect.sync(() => {
            setAvailableProjects({ _tag: "Ready", projects })
            markStartup("project-catalog-ready", { projects: projects.length })
            setInitialStateResolved(true)
            markStartup("application-state-ready")
            const restored = restoreApplicationState(state, projects)
            setRestoredProjectUIStates(restored.projectUIStates)
            startupLocationKey.current = restored.activeLocationKey ?? null
            for (const project of restored.projects) {
              if (locationKey(project.location) === restored.activeLocationKey)
                markStartup("project-open-start")
              openLocation(project, false, project.location)
            }
            setActiveLocationKey(restored.activeLocationKey ?? null)
            persistLocationSelection(locationsRef.current, restored.activeLocationKey ?? null)
            markStartup("project-selection-ready")
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            setInitialStateResolved(true)
            markStartup("application-state-ready")
            setAvailableProjects({ _tag: "Error", message: error.message })
          }),
        ),
      ),
    )
  }, [openLocation, persistLocationSelection])

  const newProject = useCallback(() => {
    if (selectionFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(selectionFiber.current))
    selectionFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.selectProject).pipe(
        Effect.tap((selection) =>
          Option.match(selection, {
            onNone: () => Effect.void,
            onSome: (project) =>
              Effect.sync(() => {
                setAvailableProjects((state) => {
                  if (state._tag !== "Ready") return state
                  return {
                    _tag: "Ready",
                    projects: mergeProjectCatalogEntry(state.projects, project),
                  }
                })
                openLocation(
                  project,
                  true,
                  project.locations.find((location) => location.kind === "selected")?.ref,
                )
              }),
          }),
        ),
        Effect.catch((error) => Effect.sync(() => setLandingError(error.message))),
      ),
    )
  }, [openLocation])

  useEffect(() => {
    let disposed = false
    let remove: (() => void) | undefined
    AppRuntime.runPromise(
      DesktopBridge.use((desktop) =>
        desktop.subscribeOpenCodeEvents((event) => {
          eventChain.current = eventChain.current
            .then(() => AppRuntime.runPromise(handleOpenCodeEvent(event)))
            .catch((error: unknown) => {
              if (!disposed)
                setLandingError(error instanceof Error ? error.message : "OpenCode event failed.")
            })
        }),
      ),
    )
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else remove = unsubscribe
      })
      .catch((error: unknown) => {
        if (!disposed)
          setLandingError(error instanceof Error ? error.message : "OpenCode event stream failed.")
      })
    return () => {
      disposed = true
      remove?.()
    }
  }, [handleOpenCodeEvent])

  useEffect(() => loadProjects(), [loadProjects])

  useEffect(
    () => () => {
      AppRuntime.runFork(
        Fiber.interruptAll([
          ...Array.from(locationConnections.current.values(), (connection) => connection.fiber),
          ...[selectionFiber.current, availableProjectsFiber.current].filter(
            (fiber): fiber is Fiber.Fiber<unknown, unknown> => fiber !== null,
          ),
        ]),
      )
    },
    [],
  )

  return {
    activeLocationKey,
    openLocations,
    sessions,
    availableProjects,
    restoredProjectUIStates,
    initialStateResolved,
    landingError,
    loadProjects,
    newProject,
    openLocation,
    ensureLocation,
    openGlobalProject,
    activateLocation,
    closeLocation,
    selectSession,
    createSession,
    submitPrompt,
    updateSessionInbox,
    replyQuestion,
    rejectQuestion,
    backgroundSession,
    interruptSession,
  } as const
}
