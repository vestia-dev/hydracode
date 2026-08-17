import { startTransition, useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber, Option, Schema } from "effect"
import { AbsolutePath, Location, Project, Session, type Question } from "@opencode-ai/client/effect"
import { AppRuntime } from "../runtime"
import { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { ProjectView, SessionView } from "../services/OpenCodeGateway"
import { buildSessionGraph } from "../domain/sessionGraph"
import {
  createProvisionalSessionID,
  applyOptimisticPrompts,
  type OptimisticPrompt,
} from "../domain/optimisticPrompts"
import type {
  ProjectCatalogEntry,
  ProjectPendingPrompt,
  ProjectUpdate,
} from "../../../shared/project"
import {
  applyProjectUpdate as reduceProjectUpdate,
  createSessionView,
  openProjectState,
  type OpenLocationState,
} from "../domain/projectLocationState"
import { restoreApplicationState } from "../domain/applicationState"
import { markStartup, recordStartupMeasure } from "../startupTiming"
import { locationKey, mergeProjectCatalogEntry } from "../../../shared/domain/projectCatalog"

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

  const applyProjectUpdate = useCallback(
    (locationKeyValue: string, update: ProjectUpdate) =>
      Effect.sync(() => {
        const started = performance.now()
        const projectUpdate = () =>
          updateProject(locationKeyValue, (current) =>
            reduceProjectUpdate(current.projectID, current, update),
          )
        if (update._tag === "Session") startTransition(projectUpdate)
        else projectUpdate()
        recordStartupMeasure("project-update-projection", started, {
          locationKey: locationKeyValue,
          update: update._tag,
        })
      }),
    [updateProject],
  )

  const startLocationConnection = useCallback(
    (
      key: string,
      project: ProjectCatalogEntry["project"],
      location: Location.Ref,
      onUpdate: (update: ProjectUpdate) => void,
      onConnected?: () => void,
    ) => {
      const connectionID = crypto.randomUUID()
      const pendingUpdates: Array<ProjectUpdate> = []
      let ready = false
      const program = DesktopBridge.use((desktop) =>
        Effect.scoped(
          Effect.acquireRelease(
            desktop.subscribeProject(location, (update) => {
              if (ready) onUpdate(update)
              else pendingUpdates.push(update)
            }),
            (remove) =>
              Effect.sync(remove).pipe(
                Effect.andThen(desktop.closeProject({ location })),
                Effect.ignore,
              ),
          ).pipe(
            Effect.flatMap(() => desktop.openProject({ location })),
            Effect.flatMap((projectID) =>
              Effect.all({
                projectID: Effect.succeed(projectID),
                sessions: desktop.listProjectSessions({ projectID, location }),
                activeSessionIDs: desktop.listActiveSessions,
              }),
            ),
            Effect.tap(({ projectID, sessions, activeSessionIDs }) =>
              Effect.sync(() => {
                const started = performance.now()
                if (key === startupLocationKey.current)
                  markStartup("project-open-received", { sessions: sessions.length })
                updateProject(key, (current) =>
                  openProjectState(current, project, projectID, sessions, activeSessionIDs),
                )
                ready = true
                for (const update of pendingUpdates) onUpdate(update)
                recordStartupMeasure("project-open-projection", started, {
                  locationKey: key,
                  sessions: sessions.length,
                })
                if (key === startupLocationKey.current) markStartup("project-open-projected")
                onConnected?.()
              }),
            ),
            Effect.andThen(Effect.never),
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
      startLocationConnection(
        key,
        project.project,
        location,
        (update) => AppRuntime.runFork(applyProjectUpdate(key, update)),
        () => {
          if (key === startupLocationKey.current) markStartup("project-subscription-ready")
        },
      )
    },
    [applyProjectUpdate, persistLocationSelection, startLocationConnection],
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
      locationKeyValue: string,
      sessionID: SessionView["id"],
      text: string,
      delivery?: "queue" | "steer",
    ) =>
      Effect.gen(function* () {
        const session = locationsRef.current
          .get(locationKeyValue)
          ?.snapshot?.sessions.find((item) => item.id === sessionID)
        if (session === undefined)
          return yield* new DesktopBridgeError({
            message: "HydraCode could not find this session.",
            cause: sessionID,
          })
        const prompt = pendingPrompt(session, text.trim())
        yield* Effect.sync(() =>
          updateProject(locationKeyValue, (current) =>
            mapLocationSnapshot(current, (snapshot) => ({
              ...snapshot,
              sessions: snapshot.sessions.map((item) =>
                item.id === sessionID
                  ? withPrompts(item, [...item.optimisticPrompts, prompt])
                  : item,
              ),
            })),
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
              updateProject(locationKeyValue, (current) =>
                mapLocationSnapshot(current, (snapshot) => ({
                  ...snapshot,
                  sessions: snapshot.sessions.map((item) =>
                    item.id === sessionID
                      ? withPrompts(
                          item,
                          item.optimisticPrompts.filter((pending) => pending.id !== prompt.id),
                        )
                      : item,
                  ),
                })),
              ),
            ),
          ),
        )
      }),
    [updateProject],
  )

  const updateSessionInbox = useCallback(
    (
      _locationKeyValue: string,
      sessionID: SessionView["id"],
      inboxID: ProjectPendingPrompt["id"],
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
        return yield* DesktopBridge.use((desktop) =>
          desktop.selectSession({ sessionID: Schema.decodeUnknownSync(Session.ID)(sessionID) }),
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              updateProject(locationKeyValue, (current) => ({
                ...current,
                promptRetry: null,
              })),
            ),
          ),
        )
      }),
    [updateProject],
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
          updateProject(locationKeyValue, (current) => ({
            ...mapLocationSnapshot(current, (snapshot) => ({
              ...snapshot,
              sessions: [...snapshot.sessions, withPrompts(provisionalBase, [prompt])],
            })),
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
              updateProject(locationKeyValue, (current) => ({
                ...mapLocationSnapshot(current, (snapshot) => ({
                  ...snapshot,
                  sessions: snapshot.sessions.filter((session) => session.id !== provisionalID),
                })),
                landingError: error.message,
              }))
            }),
          ),
        )
        const session = createSessionView(result.session, undefined, [prompt])
        yield* Effect.sync(() => {
          selectCreated?.(session.id)
          updateProject(locationKeyValue, (current) =>
            mapLocationSnapshot(current, (snapshot) => ({
              ...snapshot,
              sessions: [
                ...snapshot.sessions.filter(
                  (item) => item.id !== provisionalID && item.id !== session.id,
                ),
                session,
              ],
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
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({
            sessionID: session.id,
            text: promptText,
          }),
        ).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() =>
                updateProject(locationKeyValue, (current) => ({
                  ...mapLocationSnapshot(current, (snapshot) => ({
                    ...snapshot,
                    sessions: snapshot.sessions.map((item) =>
                      item.id === session.id ? withPrompts(item, []) : item,
                    ),
                  })),
                  promptRetry: {
                    sessionID: session.id,
                    text: promptText,
                    message: error.message,
                  },
                })),
              ),
            onSuccess: () => Effect.void,
          }),
        )
      }),
    [updateProject],
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
        (update) => {
          AppRuntime.runFork(applyProjectUpdate(key, update))
        },
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
    [applyProjectUpdate, createSession, startLocationConnection, updateProject],
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
