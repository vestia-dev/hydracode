import { useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber, Option, Schema } from "effect"
import { Session, type SessionMessage } from "@opencode-ai/client/effect"
import { AppRuntime } from "../runtime"
import { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import type { SessionView, WorkspaceSnapshot } from "../services/OpenCodeGateway"
import { projectMessages } from "../projectors/sessionGraph"
import type { WorkspaceUpdate } from "../../../shared/workspace"
import type { WorkspaceSessionExecution } from "../../../shared/workspace"

export type WorkspaceState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Loading"; readonly directory: string }
  | { readonly _tag: "Ready"; readonly snapshot: WorkspaceSnapshot }
  | { readonly _tag: "Error"; readonly message: string }

const initialState: WorkspaceState = { _tag: "Idle" }
function view(value: {
  id: string
  parentID?: string | undefined
  created: number
  title: string
  active: boolean
  synchronized: boolean
  execution: WorkspaceSessionExecution
  messages: ReadonlyArray<SessionMessage.Info>
}): SessionView {
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
    graph: projectMessages(value.messages),
  }
}
function snapshot(value: {
  directory: string
  sessions: ReadonlyArray<{
    id: string
    parentID?: string | undefined
    created: number
    title: string
    active: boolean
    synchronized: boolean
    execution: WorkspaceSessionExecution
    messages: ReadonlyArray<SessionMessage.Info>
  }>
}): WorkspaceSnapshot {
  return { directory: value.directory, sessions: value.sessions.map(view) }
}

export function useWorkspaceController() {
  const [state, setState] = useState<WorkspaceState>(initialState)
  const selectionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const workspaceFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const subscriptionID = useRef<string | null>(null)

  const startWorkspace = useCallback((directory: string) => {
    if (workspaceFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(workspaceFiber.current))
    const previousSubscription = subscriptionID.current
    if (previousSubscription !== null) {
      AppRuntime.runFork(
        DesktopBridge.use((desktop) => desktop.closeWorkspace(previousSubscription)),
      )
      subscriptionID.current = null
    }
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopBridge
      yield* Effect.sync(() => setState({ _tag: "Loading", directory }))
      const id = yield* desktop.openWorkspace({ directory })
      subscriptionID.current = id
      const apply = (update: WorkspaceUpdate) =>
        Effect.sync(() => {
          if (update._tag === "Snapshot")
            setState({ _tag: "Ready", snapshot: snapshot(update.snapshot) })
          else if (update._tag === "Session")
            setState((current) =>
              current._tag !== "Ready"
                ? current
                : {
                    _tag: "Ready",
                    snapshot: {
                      ...current.snapshot,
                      sessions: [
                        ...current.snapshot.sessions.filter(
                          (item) => item.id !== update.session.id,
                        ),
                        view(update.session),
                      ],
                    },
                  },
            )
          else if (update._tag === "Removed")
            setState((current) =>
              current._tag !== "Ready"
                ? current
                : {
                    _tag: "Ready",
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
      yield* desktop.watchWorkspace(id, (update) => AppRuntime.runFork(apply(update)))
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          setState({
            _tag: "Error",
            message:
              error instanceof Error ? error.message : "HydraCode could not open this workspace.",
          }),
        ),
      ),
    )
    workspaceFiber.current = AppRuntime.runFork(program)
  }, [])

  const submitPrompt = useCallback(
    (sessionID: SessionView["id"], text: string) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this workspace.",
            cause: sessionID,
          })
        return yield* DesktopBridge.use((desktop) =>
          desktop.submitPrompt({ subscriptionID: id, sessionID, text }),
        )
      }),
    [],
  )

  const interruptSession = useCallback(
    (sessionID: SessionView["id"]) =>
      Effect.gen(function* () {
        const id = subscriptionID.current
        if (id === null)
          return yield* new DesktopBridgeError({
            message: "HydraCode is not connected to this workspace.",
            cause: sessionID,
          })
        return yield* DesktopBridge.use((desktop) =>
          desktop.interrupt({ subscriptionID: id, sessionID }),
        )
      }),
    [],
  )

  const openWorkspace = useCallback(() => {
    if (selectionFiber.current !== null) AppRuntime.runFork(Fiber.interrupt(selectionFiber.current))
    selectionFiber.current = AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.selectWorkspace).pipe(
        Effect.tap((selection) =>
          Option.match(selection, {
            onNone: () => Effect.void,
            onSome: (directory) => Effect.sync(() => startWorkspace(directory)),
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => setState({ _tag: "Error", message: error.message })),
        ),
      ),
    )
  }, [startWorkspace])

  useEffect(
    () => () => {
      const id = subscriptionID.current
      if (id !== null)
        AppRuntime.runFork(DesktopBridge.use((desktop) => desktop.closeWorkspace(id)))
      const fibers = [selectionFiber.current, workspaceFiber.current].filter(
        (fiber): fiber is Fiber.Fiber<unknown, unknown> => fiber !== null,
      )
      AppRuntime.runFork(Fiber.interruptAll(fibers))
    },
    [],
  )

  return { state, openWorkspace, submitPrompt, interruptSession } as const
}
