import { useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber, Option, Schema } from "effect"
import { AbsolutePath, Location, Session } from "@opencode-ai/client/effect"
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
  reconcileOptimisticPrompts,
  type OptimisticPrompt,
} from "../projectors/optimisticPrompts"
import type { ProjectSession, ProjectSnapshot, ProjectUpdate } from "../../../shared/project"
import type { ProjectCatalogItem } from "../../../shared/project"

export type ProjectState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading"; readonly location: Location.Ref }
  | {
      readonly _tag: "Ready"
      readonly snapshot: ProjectViewSnapshot
      readonly screen: "landing" | "session"
    }
  | { readonly _tag: "Error"; readonly message: string }

const initialState: ProjectState = { _tag: "Idle" }
export type ProjectCatalogState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly projects: ReadonlyArray<ProjectCatalogItem> }
  | { readonly _tag: "Error"; readonly message: string }
function view(
  value: ProjectSession,
  optimisticPrompts: ReadonlyArray<OptimisticPrompt> = [],
): SessionView {
  const authoritativeGraph = projectMessages(value.messages)
  const reconciled = reconcileOptimisticPrompts(optimisticPrompts, value.messages)
  return {
    id: Schema.decodeUnknownSync(Session.ID)(value.id),
    ...(value.parentID === undefined
      ? {}
      : { parentID: Schema.decodeUnknownSync(Session.ID)(value.parentID) }),
    created: value.created,
    title: value.title,
    active: value.active,
    synchronized: value.synchronized,
    execution: value.execution,
    provisional: false,
    authoritativeGraph,
    optimisticPrompts: reconciled,
    graph: projectOptimisticPrompts(authoritativeGraph, reconciled),
  }
}
function snapshot(value: ProjectSnapshot, previous?: ProjectViewSnapshot): ProjectViewSnapshot {
  const projected = value.sessions.map((session) => {
    const current = previous?.sessions.find((item) => item.id === session.id)
    return view(session, current?.optimisticPrompts)
  })
  const provisional = previous?.sessions.find((session) => session.provisional)
  return {
    project: value.project,
    location: value.location,
    sessions: provisional === undefined ? projected : [provisional],
    recentSessions: value.recentSessions.map((session) => ({
      ...session,
      id: Schema.decodeUnknownSync(Session.ID)(session.id),
    })),
  }
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

export interface PromptRetry {
  readonly sessionID: SessionView["id"]
  readonly text: string
  readonly message: string
}

export function useProjectController() {
  const [state, setState] = useState<ProjectState>(initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const [promptRetry, setPromptRetry] = useState<PromptRetry | null>(null)
  const [landingError, setLandingError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ProjectCatalogState>({ _tag: "Loading" })
  const selectionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const catalogFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const projectFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const subscriptionID = useRef<string | null>(null)

  const startProject = useCallback((location: Location.Ref) => {
    if (projectFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(projectFiber.current))
    const previousSubscription = subscriptionID.current
    if (previousSubscription !== null) {
      AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeProject(previousSubscription)))
      subscriptionID.current = null
    }
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopBridge
      yield* Effect.sync(() => setState({ _tag: "Loading", location }))
      const id = yield* desktop.openProject({ location })
      subscriptionID.current = id
      const apply = (update: ProjectUpdate) =>
        Effect.sync(() => {
          if (update._tag === "Snapshot")
            setState((current) => ({
              _tag: "Ready",
              snapshot: snapshot(
                update.snapshot,
                current._tag === "Ready" ? current.snapshot : undefined,
              ),
              screen: current._tag === "Ready" ? current.screen : "landing",
            }))
          else if (update._tag === "Session")
            setState((current) => {
              if (current._tag !== "Ready") return current
              const existing = current.snapshot.sessions.find(
                (item) => item.id === update.session.id,
              )
              if (
                existing === undefined &&
                current.snapshot.sessions.some((item) => item.provisional)
              )
                return current
              return {
                _tag: "Ready",
                screen: current.screen,
                snapshot: {
                  ...current.snapshot,
                  sessions: [
                    ...current.snapshot.sessions.filter((item) => item.id !== update.session.id),
                    view(update.session, existing?.optimisticPrompts),
                  ],
                },
              }
            })
          else if (update._tag === "Removed")
            setState((current) =>
              current._tag !== "Ready"
                ? current
                : {
                    _tag: "Ready",
                    screen: current.screen,
                    snapshot: {
                      ...current.snapshot,
                      sessions: current.snapshot.sessions.filter(
                        (item) => item.id !== update.sessionID,
                      ),
                    },
                  },
            )
          else setState({ _tag: "Error", message: update.message })
        })
      yield* desktop.watchProject(id, (update) => AppRuntime.runFork(apply(update)))
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          setState({
            _tag: "Error",
            message:
              error instanceof Error ? error.message : "HydraCode could not open this project.",
          }),
        ),
      ),
    )
    projectFiber.current = AppRuntime.runFork(program)
  }, [])

  const submitPrompt = useCallback(
    (sessionID: SessionView["id"], text: string) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this project.",
            cause: sessionID,
          })
        const session =
          stateRef.current._tag === "Ready"
            ? stateRef.current.snapshot.sessions.find((item) => item.id === sessionID)
            : undefined
        if (session === undefined)
          return yield* new DesktopBridgeError({
            message: "HydraCode could not find this session.",
            cause: sessionID,
          })
        const prompt = pendingPrompt(session, text.trim())
        yield* Effect.sync(() =>
          setState((current) =>
            current._tag !== "Ready"
              ? current
              : {
                  ...current,
                  snapshot: {
                    ...current.snapshot,
                    sessions: current.snapshot.sessions.map((item) =>
                      item.id === sessionID
                        ? withPrompts(item, [...item.optimisticPrompts, prompt])
                        : item,
                    ),
                  },
                },
          ),
        )
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({ subscriptionID: id, sessionID, text: prompt.text }),
        ).pipe(
          Effect.tapError(() =>
            Effect.sync(() =>
              setState((current) =>
                current._tag !== "Ready"
                  ? current
                  : {
                      ...current,
                      snapshot: {
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
                    },
              ),
            ),
          ),
        )
      }),
    [],
  )

  const selectSession = useCallback(
    (sessionID: SessionView["id"]) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this project.",
            cause: sessionID,
          })
        yield* DesktopBridge.use((desktop) =>
          desktop.selectSession({ subscriptionID: id, sessionID }),
        )
        return yield* Effect.sync(() => {
          setPromptRetry(null)
          setState((current) =>
            current._tag === "Ready" ? { ...current, screen: "session" } : current,
          )
        })
      }),
    [],
  )

  const createSession = useCallback(
    (text: string) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this project.",
            cause: text,
          })
        const readyState = stateRef.current
        if (readyState._tag !== "Ready")
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
          provisional: true,
          authoritativeGraph,
          optimisticPrompts: [],
          graph: authoritativeGraph,
        }
        const prompt = pendingPrompt(provisionalBase, promptText)
        const provisional = withPrompts(provisionalBase, [prompt])
        yield* Effect.sync(() => {
          setLandingError(null)
          setPromptRetry(null)
          setState((current) =>
            current._tag !== "Ready"
              ? current
              : {
                  ...current,
                  screen: "session",
                  snapshot: { ...current.snapshot, sessions: [provisional] },
                },
          )
        })
        const result = yield* DesktopBridge.use((desktop) =>
          desktop.createSession({ subscriptionID: id }),
        ).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              setLandingError(error.message)
              setState((current) =>
                current._tag !== "Ready"
                  ? current
                  : {
                      ...current,
                      screen: "landing",
                      snapshot: {
                        ...current.snapshot,
                        sessions: current.snapshot.sessions.filter(
                          (session) => session.id !== provisionalID,
                        ),
                      },
                    },
              )
            }),
          ),
        )
        const session = view(result.session, [prompt])
        yield* Effect.sync(() =>
          setState((current) =>
            current._tag !== "Ready"
              ? current
              : {
                  ...current,
                  screen: "session",
                  snapshot: {
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
                },
          ),
        )
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({ subscriptionID: id, sessionID: session.id, text: promptText }),
        ).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() => {
                setPromptRetry({ sessionID: session.id, text: promptText, message: error.message })
                setState((current) =>
                  current._tag !== "Ready"
                    ? current
                    : {
                        ...current,
                        snapshot: {
                          ...current.snapshot,
                          sessions: current.snapshot.sessions.map((item) =>
                            item.id === session.id ? withPrompts(item, []) : item,
                          ),
                        },
                      },
                )
              }),
            onSuccess: () => Effect.void,
          }),
        )
      }),
    [],
  )

  const showSessionLanding = useCallback(() => {
    setPromptRetry(null)
    setState((current) => {
      if (current._tag !== "Ready") return current
      const root = current.snapshot.sessions.find((session) => session.parentID === undefined)
      if (root === undefined) return { ...current, screen: "landing" }
      return {
        ...current,
        screen: "landing",
        snapshot: {
          ...current.snapshot,
          recentSessions: current.snapshot.recentSessions.map((session) =>
            session.id === root.id
              ? {
                  id: root.id,
                  created: root.created,
                  title: root.title,
                  active: current.snapshot.sessions.some((item) => item.active),
                }
              : session,
          ),
        },
      }
    })
  }, [])

  const interruptSession = useCallback(
    (sessionID: SessionView["id"]) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this project.",
            cause: sessionID,
          })
        return yield* DesktopBridge.use((desktop) =>
          desktop.interrupt({ subscriptionID: id, sessionID }),
        )
      }),
    [],
  )

  const loadProjects = useCallback(() => {
    if (catalogFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(catalogFiber.current))
    setCatalog({ _tag: "Loading" })
    catalogFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.listProjects).pipe(
        Effect.tap((projects) => Effect.sync(() => setCatalog({ _tag: "Ready", projects }))),
        Effect.catch((error) =>
          Effect.sync(() => setCatalog({ _tag: "Error", message: error.message })),
        ),
      ),
    )
  }, [])

  const newProject = useCallback(() => {
    if (selectionFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(selectionFiber.current))
    selectionFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.selectProject).pipe(
        Effect.tap((selection) =>
          Option.match(selection, {
            onNone: () => Effect.void,
            onSome: (directory) =>
              Effect.sync(() =>
                startProject(Location.Ref.make({ directory: AbsolutePath.make(directory) })),
              ),
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => setState({ _tag: "Error", message: error.message })),
        ),
      ),
    )
  }, [startProject])

  const openProject = useCallback(
    (project: ProjectCatalogItem) => startProject(project.location),
    [startProject],
  )

  const showProjects = useCallback(() => {
    if (projectFiber.current !== null) {
      AppRuntime.runFork(Fiber.interrupt(projectFiber.current))
      projectFiber.current = null
    }
    const id = subscriptionID.current
    if (id !== null) {
      AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeProject(id)))
      subscriptionID.current = null
    }
    setState({ _tag: "Idle" })
    loadProjects()
  }, [loadProjects])

  useEffect(() => loadProjects(), [loadProjects])

  useEffect(
    () => () => {
      const id = subscriptionID.current
      if (id !== null) AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeProject(id)))
      const fibers = [selectionFiber.current, catalogFiber.current, projectFiber.current].filter(
        (fiber): fiber is Fiber.Fiber<unknown, unknown> => fiber !== null,
      )
      AppRuntime.runFork(Fiber.interruptAll(fibers))
    },
    [],
  )

  return {
    state,
    promptRetry,
    landingError,
    catalog,
    loadProjects,
    newProject,
    openProject,
    showProjects,
    selectSession,
    createSession,
    showSessionLanding,
    submitPrompt,
    interruptSession,
  } as const
}
