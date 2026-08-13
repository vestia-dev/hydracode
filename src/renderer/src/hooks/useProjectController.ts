import { useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber, Option } from "effect"
import { AbsolutePath, Location, Project, type Question } from "@opencode-ai/client/effect"
import { AppRuntime } from "../runtime"
import { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type {
  ProjectSnapshot as ProjectViewSnapshot,
  SessionView,
} from "../services/OpenCodeGateway"
import { projectMessages } from "../projectors/sessionGraph"
import {
  createProvisionalSessionID,
  projectOptimisticPrompts,
  type OptimisticPrompt,
} from "../projectors/optimisticPrompts"
import type { AvailableProject, ProjectUpdate } from "../../../shared/project"
import {
  applyProjectUpdate as reduceProjectUpdate,
  projectSessionView,
} from "../projectors/projectRuntime"
import { restoreApplicationState } from "../projectors/applicationState"

export interface PromptRetry {
  readonly sessionID: SessionView["id"]
  readonly text: string
  readonly message: string
}

export interface OpenProjectRuntime {
  readonly projectID: Project.ID
  readonly location: Location.Ref
  readonly status: "opening" | "ready" | "error"
  readonly snapshot: ProjectViewSnapshot | undefined
  readonly error: string | undefined
  readonly promptRetry: PromptRetry | null
  readonly landingError: string | null
  readonly requestedSessionID?: SessionView["id"] | undefined
}

export type AvailableProjectsState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly projects: ReadonlyArray<AvailableProject> }
  | { readonly _tag: "Error"; readonly message: string }

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

function withPrompts(
  session: SessionView,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt>,
): SessionView {
  return {
    ...session,
    optimisticPrompts,
    graph: projectOptimisticPrompts(session.authoritativeGraph, optimisticPrompts),
  }
}

export function useProjectController() {
  const [activeProjectID, setActiveProjectID] = useState<Project.ID | null>(null)
  const [openProjects, setOpenProjects] = useState<ReadonlyMap<Project.ID, OpenProjectRuntime>>(
    () => new Map(),
  )
  const projectsRef = useRef(openProjects)
  projectsRef.current = openProjects
  const [availableProjects, setAvailableProjects] = useState<AvailableProjectsState>({
    _tag: "Loading",
  })
  const [landingError, setLandingError] = useState<string | null>(null)
  const selectionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const availableProjectsFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const projectFibers = useRef(new Map<Project.ID, Fiber.Fiber<unknown, unknown>>())
  const subscriptionIDs = useRef(new Map<Project.ID, string>())

  const persistProjectSelection = useCallback(
    (projects: ReadonlyMap<Project.ID, OpenProjectRuntime>, activeID: Project.ID | null) => {
      const openProjectIDs = Array.from(projects.keys()).filter((id) => id !== Project.ID.global)
      AppRuntime.runFork(
        DesktopBridge.use((desktop) =>
          desktop.saveProjectSelection({
            openProjectIDs,
            activeProjectID:
              activeID === Project.ID.global ? (openProjectIDs[0] ?? null) : activeID,
          }),
        ).pipe(Effect.catch((error) => Effect.sync(() => setLandingError(error.message)))),
      )
    },
    [],
  )

  const updateProject = useCallback(
    (projectID: Project.ID, update: (runtime: OpenProjectRuntime) => OpenProjectRuntime) => {
      const runtime = projectsRef.current.get(projectID)
      if (runtime === undefined) return
      const next = new Map(projectsRef.current)
      next.set(projectID, update(runtime))
      projectsRef.current = next
      setOpenProjects(next)
    },
    [],
  )

  const withProjectSubscription = useCallback(
    <A, E, R>(
      projectID: Project.ID,
      cause: unknown,
      operation: (subscriptionID: string) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | DesktopBridgeError, R> => {
      const id = subscriptionIDs.current.get(projectID)
      return id === undefined
        ? Effect.fail(
            new DesktopBridgeError({
              message: "HydraCode is not connected to this project.",
              cause,
            }),
          )
        : operation(id)
    },
    [],
  )

  const applyProjectUpdate = useCallback(
    (projectID: Project.ID, update: ProjectUpdate) =>
      Effect.sync(() => {
        updateProject(projectID, (current) => reduceProjectUpdate(projectID, current, update))
      }),
    [updateProject],
  )

  const openProject = useCallback(
    (project: AvailableProject, persist = true) => {
      const projectID = project.project.id
      if (projectsRef.current.has(projectID)) {
        setActiveProjectID(projectID)
        if (persist) persistProjectSelection(projectsRef.current, projectID)
        return
      }
      const runtime: OpenProjectRuntime = {
        projectID,
        location: project.location,
        status: "opening",
        snapshot: undefined,
        error: undefined,
        promptRetry: null,
        landingError: null,
      }
      projectsRef.current = new Map(projectsRef.current).set(projectID, runtime)
      setOpenProjects(projectsRef.current)
      setActiveProjectID(projectID)
      setLandingError(null)
      if (persist) persistProjectSelection(projectsRef.current, projectID)

      const program = Effect.gen(function* () {
        const desktop = yield* DesktopBridge
        const subscriptionID = yield* desktop.openProject({ location: project.location })
        subscriptionIDs.current.set(projectID, subscriptionID)
        yield* desktop.watchProject(subscriptionID, (update) =>
          AppRuntime.runFork(applyProjectUpdate(projectID, update)),
        )
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            updateProject(projectID, (current) => ({
              ...current,
              status: "error",
              error: error.message,
            })),
          ),
        ),
      )
      projectFibers.current.set(projectID, AppRuntime.runFork(program))
    },
    [applyProjectUpdate, persistProjectSelection, updateProject],
  )

  const activateProject = useCallback(
    (projectID: Project.ID) => {
      if (!projectsRef.current.has(projectID)) return
      setActiveProjectID(projectID)
      persistProjectSelection(projectsRef.current, projectID)
    },
    [persistProjectSelection],
  )

  const closeProject = useCallback(
    (projectID: Project.ID) => {
      const fiber = projectFibers.current.get(projectID)
      if (fiber !== undefined) AppRuntime.runFork(Fiber.interrupt(fiber))
      projectFibers.current.delete(projectID)
      const subscriptionID = subscriptionIDs.current.get(projectID)
      if (subscriptionID !== undefined)
        AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeProject(subscriptionID)))
      subscriptionIDs.current.delete(projectID)
      setOpenProjects((current) => {
        const next = new Map(current)
        next.delete(projectID)
        projectsRef.current = next
        setActiveProjectID((active) => {
          const nextActive = active === projectID ? (next.keys().next().value ?? null) : active
          persistProjectSelection(next, nextActive)
          return nextActive
        })
        return next
      })
    },
    [persistProjectSelection],
  )

  const submitPrompt = useCallback(
    (projectID: Project.ID, sessionID: SessionView["id"], text: string) =>
      withProjectSubscription(projectID, sessionID, (subscriptionID) =>
        Effect.gen(function* () {
          const session = projectsRef.current
            .get(projectID)
            ?.snapshot?.sessions.find((item) => item.id === sessionID)
          if (session === undefined)
            return yield* new DesktopBridgeError({
              message: "HydraCode could not find this session.",
              cause: sessionID,
            })
          const prompt = pendingPrompt(session, text.trim())
          yield* Effect.sync(() =>
            updateProject(projectID, (current) => ({
              ...current,
              snapshot:
                current.snapshot === undefined
                  ? undefined
                  : {
                      ...current.snapshot,
                      sessions: current.snapshot.sessions.map((item) =>
                        item.id === sessionID
                          ? withPrompts(item, [...item.optimisticPrompts, prompt])
                          : item,
                      ),
                    },
            })),
          )
          return yield* DesktopBridge.use((desktop) =>
            desktop.submitPrompt({ subscriptionID, sessionID, text: prompt.text }),
          ).pipe(
            Effect.tapError(() =>
              Effect.sync(() =>
                updateProject(projectID, (current) => ({
                  ...current,
                  snapshot:
                    current.snapshot === undefined
                      ? undefined
                      : {
                          ...current.snapshot,
                          sessions: current.snapshot.sessions.map((item) =>
                            item.id === sessionID
                              ? withPrompts(
                                  item,
                                  item.optimisticPrompts.filter(
                                    (pending) => pending.id !== prompt.id,
                                  ),
                                )
                              : item,
                          ),
                        },
                })),
              ),
            ),
          )
        }),
      ),
    [updateProject, withProjectSubscription],
  )

  const selectSession = useCallback(
    (projectID: Project.ID, sessionID: string) =>
      withProjectSubscription(projectID, sessionID, (subscriptionID) =>
        DesktopBridge.use((desktop) => desktop.selectSession({ subscriptionID, sessionID })).pipe(
          Effect.tap(() =>
            Effect.sync(() =>
              updateProject(projectID, (current) => ({ ...current, promptRetry: null })),
            ),
          ),
        ),
      ),
    [updateProject, withProjectSubscription],
  )

  const createSession = useCallback(
    (
      projectID: Project.ID,
      text: string,
      selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
    ) =>
      withProjectSubscription(projectID, text, (subscriptionID) =>
        Effect.gen(function* () {
          const currentSnapshot = projectsRef.current.get(projectID)?.snapshot
          if (currentSnapshot === undefined)
            return yield* new DesktopBridgeError({
              message: "HydraCode is not ready to create a session.",
              cause: text,
            })
          const promptText = text.trim()
          const provisionalID = createProvisionalSessionID()
          const authoritativeGraph = projectMessages([])
          const provisionalBase: SessionView = {
            id: provisionalID,
            created: Date.now(),
            title: "New session",
            active: false,
            synchronized: true,
            execution: { _tag: "Idle" },
            questions: [],
            provisional: true,
            authoritativeGraph,
            optimisticPrompts: [],
            graph: authoritativeGraph,
          }
          const prompt = pendingPrompt(provisionalBase, promptText)
          yield* Effect.sync(() => {
            updateProject(projectID, (current) => ({
              ...current,
              landingError: null,
              promptRetry: null,
              snapshot:
                current.snapshot === undefined
                  ? undefined
                  : {
                      ...current.snapshot,
                      sessions: [
                        ...current.snapshot.sessions,
                        withPrompts(provisionalBase, [prompt]),
                      ],
                    },
            }))
            selectCreated?.(provisionalID)
          })
          const result = yield* DesktopBridge.use((desktop) =>
            desktop.createSession({ subscriptionID }),
          ).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                selectCreated?.(undefined)
                updateProject(projectID, (current) => ({
                  ...current,
                  landingError: error.message,
                  snapshot:
                    current.snapshot === undefined
                      ? undefined
                      : {
                          ...current.snapshot,
                          sessions: current.snapshot.sessions.filter(
                            (session) => session.id !== provisionalID,
                          ),
                        },
                }))
              }),
            ),
          )
          const session = projectSessionView(result.session, [prompt])
          yield* Effect.sync(() => {
            selectCreated?.(session.id)
            updateProject(projectID, (current) => ({
              ...current,
              snapshot:
                current.snapshot === undefined
                  ? undefined
                  : {
                      ...current.snapshot,
                      sessions: [
                        ...current.snapshot.sessions.filter(
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
                        ...current.snapshot.recentSessions.filter((item) => item.id !== session.id),
                      ],
                    },
            }))
          })
          return yield* DesktopBridge.use((desktop) =>
            desktop.submitPrompt({ subscriptionID, sessionID: session.id, text: promptText }),
          ).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Effect.sync(() =>
                  updateProject(projectID, (current) => ({
                    ...current,
                    promptRetry: {
                      sessionID: session.id,
                      text: promptText,
                      message: error.message,
                    },
                    snapshot:
                      current.snapshot === undefined
                        ? undefined
                        : {
                            ...current.snapshot,
                            sessions: current.snapshot.sessions.map((item) =>
                              item.id === session.id ? withPrompts(item, []) : item,
                            ),
                          },
                  })),
                ),
              onSuccess: () => Effect.void,
            }),
          )
        }),
      ),
    [updateProject, withProjectSubscription],
  )

  const openHome = useCallback(
    (text: string) => {
      const projectID = Project.ID.global
      const existing = projectsRef.current.get(projectID)
      if (existing !== undefined) {
        setActiveProjectID(projectID)
        return createSession(projectID, text)
      }
      const runtime: OpenProjectRuntime = {
        projectID,
        location: Location.Ref.make({ directory: AbsolutePath.make("/") }),
        status: "opening",
        snapshot: undefined,
        error: undefined,
        promptRetry: null,
        landingError: null,
      }
      projectsRef.current = new Map(projectsRef.current).set(projectID, runtime)
      setOpenProjects(projectsRef.current)
      setActiveProjectID(projectID)
      setLandingError(null)

      const program = Effect.gen(function* () {
        const desktop = yield* DesktopBridge
        const subscriptionID = yield* desktop.openProject({})
        subscriptionIDs.current.set(projectID, subscriptionID)
        let started = false
        yield* desktop.watchProject(subscriptionID, (update) => {
          AppRuntime.runFork(applyProjectUpdate(projectID, update))
          if (update._tag !== "Snapshot" || started) return
          started = true
          AppRuntime.runFork(
            createSession(projectID, text, (sessionID) => {
              if (sessionID === undefined) return
              updateProject(projectID, (current) => ({ ...current, requestedSessionID: sessionID }))
            }).pipe(Effect.catch((error) => Effect.sync(() => setLandingError(error.message)))),
          )
        })
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            updateProject(projectID, (current) => ({
              ...current,
              status: "error",
              error: error.message,
            }))
          }),
        ),
      )
      projectFibers.current.set(projectID, AppRuntime.runFork(program))
      return Effect.void
    },
    [applyProjectUpdate, createSession, updateProject],
  )

  const interruptSession = useCallback(
    (projectID: Project.ID, sessionID: SessionView["id"]) =>
      withProjectSubscription(projectID, sessionID, (subscriptionID) =>
        DesktopBridge.use((desktop) => desktop.interrupt({ subscriptionID, sessionID })),
      ),
    [withProjectSubscription],
  )

  const replyQuestion = useCallback(
    (projectID: Project.ID, request: Question.Request, answers: ReadonlyArray<Question.Answer>) =>
      withProjectSubscription(projectID, request.id, (subscriptionID) =>
        DesktopBridge.use((desktop) =>
          desktop.replyQuestion({
            subscriptionID,
            sessionID: request.sessionID,
            requestID: request.id,
            answers,
          }),
        ),
      ),
    [withProjectSubscription],
  )

  const rejectQuestion = useCallback(
    (projectID: Project.ID, request: Question.Request) =>
      withProjectSubscription(projectID, request.id, (subscriptionID) =>
        DesktopBridge.use((desktop) =>
          desktop.rejectQuestion({
            subscriptionID,
            sessionID: request.sessionID,
            requestID: request.id,
          }),
        ),
      ),
    [withProjectSubscription],
  )

  const loadProjects = useCallback(() => {
    if (availableProjectsFiber.current !== null)
      AppRuntime.runFork(Fiber.interrupt(availableProjectsFiber.current))
    setAvailableProjects({ _tag: "Loading" })
    availableProjectsFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) =>
        Effect.all([desktop.listProjects, desktop.loadApplicationState]),
      ).pipe(
        Effect.tap(([projects, state]) =>
          Effect.sync(() => {
            setAvailableProjects({ _tag: "Ready", projects })
            const restored = restoreApplicationState(state, projects)
            for (const project of restored.projects) openProject(project, false)
            setActiveProjectID(restored.activeProjectID)
            persistProjectSelection(projectsRef.current, restored.activeProjectID)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => setAvailableProjects({ _tag: "Error", message: error.message })),
        ),
      ),
    )
  }, [openProject, persistProjectSelection])

  const newProject = useCallback(() => {
    if (selectionFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(selectionFiber.current))
    selectionFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.selectProject).pipe(
        Effect.tap((selection) =>
          Option.match(selection, {
            onNone: () => Effect.void,
            onSome: (project) =>
              Effect.sync(() => {
                setAvailableProjects((state) =>
                  state._tag === "Ready" &&
                  !state.projects.some((item) => item.project.id === project.project.id)
                    ? { _tag: "Ready", projects: [project, ...state.projects] }
                    : state,
                )
                openProject(project)
              }),
          }),
        ),
        Effect.catch((error) => Effect.sync(() => setLandingError(error.message))),
      ),
    )
  }, [openProject])

  useEffect(() => loadProjects(), [loadProjects])

  useEffect(
    () => () => {
      for (const subscriptionID of subscriptionIDs.current.values())
        AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeProject(subscriptionID)))
      AppRuntime.runFork(
        Fiber.interruptAll([
          ...projectFibers.current.values(),
          ...[selectionFiber.current, availableProjectsFiber.current].filter(
            (fiber): fiber is Fiber.Fiber<unknown, unknown> => fiber !== null,
          ),
        ]),
      )
    },
    [],
  )

  return {
    activeProjectID,
    openProjects,
    availableProjects,
    landingError,
    loadProjects,
    newProject,
    openProject,
    openHome,
    activateProject,
    closeProject,
    selectSession,
    createSession,
    submitPrompt,
    replyQuestion,
    rejectQuestion,
    interruptSession,
  } as const
}
