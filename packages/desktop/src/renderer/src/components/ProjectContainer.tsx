import {
  Profiler,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react"
import { Effect, Schema } from "effect"
import { Session, type Question } from "@opencode-ai/client/effect"
import { ProjectView } from "./ProjectView"
import { savePaneLayout } from "../domain/paneLayout"
import { createPaneState, reducePaneState, type PaneStateAction } from "../domain/paneState"
import type { PaneDirection, PaneSplitCommand } from "../../../shared/pane"
import type { PaneUIState, ProjectUIState } from "../../../shared/applicationState"
import type { OpenLocationState } from "../domain/projectLocationState"
import type { SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge } from "../services/DesktopBridge"
import type { ProjectCatalogEntry } from "../../../shared/project"
import {
  DesktopBridge as DesktopBridgeService,
  DesktopBridgeError,
} from "../services/DesktopBridge"
import { AppRuntime } from "../runtime"
import { markStartup, recordStartupDuration, recordStartupMeasure } from "../startupTiming"

export interface ProjectContainerHandle {
  readonly split: (command: PaneSplitCommand) => void
  readonly focus: (direction: PaneDirection) => void
  readonly closePane: () => void
  readonly focusPrompt: () => void
  readonly followLatest: () => void
  readonly newSession: () => void
}

interface ProjectContainerProps {
  readonly defaultLocationState: OpenLocationState
  readonly locationStates: ReadonlyMap<string, OpenLocationState>
  readonly sessions: ReadonlyMap<SessionView["id"], SessionView>
  readonly project: ProjectCatalogEntry
  readonly selectLocation: (location: ProjectCatalogEntry["locations"][number]["ref"]) => void
  readonly active: boolean
  readonly initialUIState: ProjectUIState | undefined
  readonly initialRestorationComplete: () => void
  readonly uiStateCache: React.MutableRefObject<Map<string, ProjectUIState>>
  readonly selectSession: (
    locationKey: string,
    sessionID: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly createSession: (
    locationKey: string,
    text: string,
    selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly submitPrompt: (
    locationKey: string,
    sessionID: SessionView["id"],
    text: string,
    delivery?: "queue" | "steer",
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly updateSessionInbox: (
    locationKey: string,
    sessionID: SessionView["id"],
    inboxID: SessionView["pendingPrompts"][number]["id"],
    action: "cancel" | "queue" | "steer",
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly replyQuestion: (
    locationKey: string,
    request: Question.Request,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly rejectQuestion: (
    locationKey: string,
    request: Question.Request,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly backgroundSession: (
    locationKey: string,
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    locationKey: string,
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

export const ProjectContainer = forwardRef<ProjectContainerHandle, ProjectContainerProps>(
  function ProjectContainer(props, ref) {
    const [paneState, dispatch] = useReducer(reducePaneState, undefined, () =>
      createPaneState(
        crypto.randomUUID(),
        props.defaultLocationState.locationKey,
        props.initialUIState,
      ),
    )
    const paneStateRef = useRef(paneState)
    paneStateRef.current = paneState
    const dispatchPaneAction = useCallback((action: PaneStateAction) => {
      paneStateRef.current = reducePaneState(paneStateRef.current, action)
      dispatch(action)
    }, [])
    const [promptFocusRequest, setPromptFocusRequest] = useState<{
      readonly paneID: string
      readonly sequence: number
    } | null>(null)
    const [followLatestRequest, setFollowLatestRequest] = useState<{
      readonly paneID: string
      readonly sequence: number
    } | null>(null)
    const promptFocusSequence = useRef(0)
    const followLatestSequence = useRef(0)
    const defaultLocationStateRef = useRef(props.defaultLocationState)
    defaultLocationStateRef.current = props.defaultLocationState
    const displayedLocationKeyRef = useRef(props.defaultLocationState.locationKey)
    const restorationCompleted = useRef(false)
    const restoredSessionIDs = useRef(new Set<string>())
    const updatePaneUIState = useCallback(
      (paneID: string, update: Partial<Omit<PaneUIState, "paneID">>) => {
        dispatchPaneAction({ _tag: "UpdatePane", paneID, update })
      },
      [dispatchPaneAction],
    )

    const persistProjectUIState = useCallback(() => {
      const locationState = defaultLocationStateRef.current
      if (locationState.snapshot === undefined) return
      const state: ProjectUIState = {
        locationKey: locationState.locationKey,
        projectID: locationState.projectID,
        activePaneID: paneStateRef.current.activePaneID,
        layout: savePaneLayout(paneStateRef.current.layout),
        panes: Array.from(paneStateRef.current.panes.values()),
        updated: Date.now(),
      }
      props.uiStateCache.current.set(locationState.locationKey, state)
      AppRuntime.runFork(
        DesktopBridgeService.use((desktop) => desktop.saveProjectUIState(state)).pipe(
          Effect.catch(() => Effect.void),
        ),
      )
    }, [props.uiStateCache])

    const splitActivePane = useCallback(
      (command: PaneSplitCommand) => {
        dispatchPaneAction({
          _tag: "Split",
          command,
          splitID: crypto.randomUUID(),
          newPaneID: crypto.randomUUID(),
          locationKey: defaultLocationStateRef.current.locationKey,
        })
      },
      [dispatchPaneAction],
    )

    const closeActivePane = useCallback(() => {
      dispatchPaneAction({ _tag: "Close" })
    }, [dispatchPaneAction])

    const focusPaneInDirection = useCallback(
      (direction: PaneDirection) => dispatchPaneAction({ _tag: "FocusDirection", direction }),
      [dispatchPaneAction],
    )

    const focusActivePrompt = useCallback(() => {
      promptFocusSequence.current += 1
      setPromptFocusRequest({
        paneID: paneStateRef.current.activePaneID,
        sequence: promptFocusSequence.current,
      })
    }, [])

    const followActiveLatest = useCallback(() => {
      followLatestSequence.current += 1
      setFollowLatestRequest({
        paneID: paneStateRef.current.activePaneID,
        sequence: followLatestSequence.current,
      })
    }, [])

    const newSession = useCallback(() => {
      updatePaneUIState(paneStateRef.current.activePaneID, {
        content: {
          _tag: "NewSession",
          locationKey: defaultLocationStateRef.current.locationKey,
        },
      })
    }, [updatePaneUIState])

    useEffect(() => {
      const locationKey = props.defaultLocationState.locationKey
      if (displayedLocationKeyRef.current === locationKey) return
      displayedLocationKeyRef.current = locationKey
      if (!props.active) return
      updatePaneUIState(paneStateRef.current.activePaneID, {
        content: { _tag: "NewSession", locationKey },
      })
    }, [props.active, props.defaultLocationState.locationKey, updatePaneUIState])

    useImperativeHandle(
      ref,
      () => ({
        split: splitActivePane,
        focus: focusPaneInDirection,
        closePane: closeActivePane,
        focusPrompt: focusActivePrompt,
        followLatest: followActiveLatest,
        newSession,
      }),
      [
        closeActivePane,
        focusActivePrompt,
        focusPaneInDirection,
        followActiveLatest,
        newSession,
        splitActivePane,
      ],
    )

    useEffect(() => {
      if (props.defaultLocationState.status !== "ready") return
      const restoredSessions: Array<{
        readonly locationKey: string
        readonly sessionID: string
      }> = Array.from(paneState.panes.values()).flatMap((pane) => {
        if (
          pane.content?._tag !== "Session" ||
          restoredSessionIDs.current.has(pane.content.sessionID)
        )
          return []
        const sessionID = pane.content.sessionID
        const loaded = props.sessions.get(Schema.decodeUnknownSync(Session.ID)(sessionID))
        const location = Array.from(props.locationStates.entries()).find(([, state]) =>
          loaded !== undefined
            ? state.location.directory === loaded.location.directory &&
              state.location.workspaceID === loaded.location.workspaceID
            : (state.snapshot?.recentSessions.some((session) => session.id === sessionID) ?? false),
        )
        if (location === undefined) return []
        restoredSessionIDs.current.add(sessionID)
        return [{ locationKey: location[0], sessionID }]
      })
      if (props.active && !restorationCompleted.current)
        markStartup("session-restoration-start", {
          sessions: restoredSessions.length,
        })
      AppRuntime.runFork(
        (restoredSessions.length === 0
          ? Effect.void
          : Effect.forEach(
              restoredSessions,
              ({ locationKey, sessionID }) => {
                const started = performance.now()
                return props.selectSession(locationKey, sessionID).pipe(
                  Effect.ensuring(
                    Effect.sync(() =>
                      recordStartupMeasure("session-selection", started, {
                        locationKey,
                        sessionID,
                      }),
                    ),
                  ),
                  Effect.catch(() => Effect.void),
                )
              },
              { concurrency: 4, discard: true },
            )
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (!restorationCompleted.current) {
                restorationCompleted.current = true
                if (props.active) markStartup("session-selections-ready")
                props.initialRestorationComplete()
              }
            }),
          ),
        ),
      )
      if (props.active && !restorationCompleted.current)
        markStartup("session-restoration-dispatched")
    }, [
      paneState.panes,
      props.initialRestorationComplete,
      props.defaultLocationState.locationKey,
      props.defaultLocationState.status,
      props.locationStates,
      props.selectSession,
    ])

    useEffect(() => {
      const sessionID = props.defaultLocationState.requestedSessionID
      if (sessionID === undefined) return
      updatePaneUIState(paneStateRef.current.activePaneID, {
        content: { _tag: "Session", sessionID },
      })
    }, [props.defaultLocationState.requestedSessionID, updatePaneUIState])

    useEffect(() => {
      const timeout = window.setTimeout(persistProjectUIState, 300)
      return () => window.clearTimeout(timeout)
    }, [paneState, persistProjectUIState])

    useEffect(() => () => persistProjectUIState(), [persistProjectUIState])

    if (props.defaultLocationState.snapshot === undefined) return null
    const locationKey = props.defaultLocationState.locationKey
    return (
      <section className="project-layer" inert={!props.active} data-active={props.active}>
        <Profiler
          id={`location:${locationKey}`}
          onRender={(_id, phase, actualDuration, baseDuration, startTime) =>
            recordStartupDuration("react-project-render", startTime, actualDuration, {
              locationKey,
              active: props.active ? 1 : 0,
              phase,
              baseDuration,
            })
          }
        >
          <ProjectView
            sessions={props.sessions}
            locationStates={props.locationStates}
            defaultLocationKey={locationKey}
            project={props.project}
            selectLocation={props.selectLocation}
            layout={paneState.layout}
            activePaneID={paneState.activePaneID}
            promptFocusRequest={promptFocusRequest}
            followLatestRequest={followLatestRequest}
            landingError={props.defaultLocationState.landingError}
            focusPane={(paneID) => dispatchPaneAction({ _tag: "Focus", paneID })}
            resizeSplit={(splitID, ratio) => dispatchPaneAction({ _tag: "Resize", splitID, ratio })}
            selectSession={props.selectSession}
            createSession={props.createSession}
            submitPrompt={props.submitPrompt}
            updateSessionInbox={props.updateSessionInbox}
            replyQuestion={props.replyQuestion}
            rejectQuestion={props.rejectQuestion}
            backgroundSession={props.backgroundSession}
            interruptSession={props.interruptSession}
            paneUIStates={paneState.panes}
            updatePaneUIState={updatePaneUIState}
          />
        </Profiler>
      </section>
    )
  },
)
