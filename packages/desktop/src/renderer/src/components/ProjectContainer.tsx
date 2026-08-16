import {
  Profiler,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Effect } from "effect"
import { type Question } from "@opencode-ai/client/effect"
import { ProjectView } from "./ProjectView"
import {
  adjacentPaneID,
  closePane,
  firstPaneID,
  hasPane,
  initialPaneLayout,
  paneInDirection,
  restorePaneLayout,
  savePaneLayout,
  splitPane,
  type PaneLayout,
} from "../domain/paneLayout"
import type { PaneDirection, PaneSplitCommand } from "../../../shared/pane"
import type { PaneUIState, ProjectUIState } from "../../../shared/applicationState"
import type { OpenLocationState } from "../hooks/useProjectController"
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
    const restoredLayout =
      props.initialUIState === undefined
        ? undefined
        : restorePaneLayout(props.initialUIState.layout)
    const initialPaneID = crypto.randomUUID()
    const [paneLayout, setPaneLayout] = useState<PaneLayout>(
      () => restoredLayout ?? initialPaneLayout(initialPaneID),
    )
    const [activePaneID, setActivePaneID] = useState(() =>
      restoredLayout === undefined
        ? initialPaneID
        : hasPane(restoredLayout, props.initialUIState?.activePaneID ?? "")
          ? (props.initialUIState?.activePaneID ?? firstPaneID(restoredLayout))
          : firstPaneID(restoredLayout),
    )
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
    const paneLayoutRef = useRef(paneLayout)
    paneLayoutRef.current = paneLayout
    const activePaneIDRef = useRef(activePaneID)
    activePaneIDRef.current = activePaneID
    const defaultLocationStateRef = useRef(props.defaultLocationState)
    defaultLocationStateRef.current = props.defaultLocationState
    const displayedLocationKeyRef = useRef(props.defaultLocationState.locationKey)
    const restorationCompleted = useRef(false)
    const restoredSessionIDs = useRef(new Set<string>())
    const [paneUIStates, setPaneUIStates] = useState<ReadonlyMap<string, PaneUIState>>(() => {
      if (restoredLayout === undefined) return new Map()
      const savedNodes = new Map(
        props.initialUIState?.layout.nodes.map((node) => [node.id, node]) ?? [],
      )
      const savedPanes = new Map(
        (props.initialUIState?.panes ?? []).map((pane) => [pane.paneID, pane]),
      )
      return new Map(
        Array.from(savedNodes.values()).flatMap((saved) => {
          if (saved._tag !== "Pane") return []
          const pane = savedPanes.get(saved.id) ?? {
            paneID: saved.id,
            followLatest: true,
            expandedRoundIDs: [],
            expandedSubagentIDs: [],
            draft: "",
          }
          if (pane.content !== undefined) return [[pane.paneID, pane]]
          const content =
            saved.sessionID !== undefined
              ? { _tag: "Session" as const, sessionID: saved.sessionID }
              : {
                  _tag: "NewSession" as const,
                  locationKey:
                    saved.locationKey !== undefined
                      ? saved.locationKey
                      : props.defaultLocationState.locationKey,
                }
          return [[pane.paneID, { ...pane, content }]]
        }),
      )
    })
    const paneUIStatesRef = useRef(paneUIStates)
    paneUIStatesRef.current = paneUIStates

    const updatePaneUIState = useCallback(
      (paneID: string, update: Partial<Omit<PaneUIState, "paneID">>) => {
        setPaneUIStates((current) => {
          const previous = current.get(paneID) ?? {
            paneID,
            followLatest: true,
            expandedRoundIDs: [],
            expandedSubagentIDs: [],
            draft: "",
          }
          const next = new Map(current)
          next.set(paneID, { ...previous, ...update })
          return next
        })
      },
      [],
    )

    const persistProjectUIState = useCallback(() => {
      const locationState = defaultLocationStateRef.current
      if (locationState.snapshot === undefined) return
      const state: ProjectUIState = {
        locationKey: locationState.locationKey,
        projectID: locationState.projectID,
        activePaneID: activePaneIDRef.current,
        layout: savePaneLayout(paneLayoutRef.current),
        panes: Array.from(paneUIStatesRef.current.values()),
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
        const newPaneID = crypto.randomUUID()
        const next = splitPane(
          paneLayoutRef.current,
          activePaneIDRef.current,
          command,
          crypto.randomUUID(),
          newPaneID,
        )
        paneLayoutRef.current = next
        activePaneIDRef.current = newPaneID
        updatePaneUIState(newPaneID, {
          content: {
            _tag: "NewSession",
            locationKey: defaultLocationStateRef.current.locationKey,
          },
        })
        setPaneLayout(next)
        setActivePaneID(newPaneID)
      },
      [updatePaneUIState],
    )

    const closeActivePane = useCallback(() => {
      const current = paneLayoutRef.current
      const paneID = activePaneIDRef.current
      const next = closePane(current, paneID)
      if (next === current) return
      const nextPaneID = adjacentPaneID(current, paneID) ?? firstPaneID(next)
      paneLayoutRef.current = next
      activePaneIDRef.current = nextPaneID
      setPaneUIStates((states) => {
        const updated = new Map(states)
        updated.delete(paneID)
        return updated
      })
      setPaneLayout(next)
      setActivePaneID(nextPaneID)
    }, [])

    const focusPaneInDirection = useCallback((direction: PaneDirection) => {
      const paneID = paneInDirection(paneLayoutRef.current, activePaneIDRef.current, direction)
      if (paneID === undefined) return
      activePaneIDRef.current = paneID
      setActivePaneID(paneID)
    }, [])

    const focusActivePrompt = useCallback(() => {
      promptFocusSequence.current += 1
      setPromptFocusRequest({
        paneID: activePaneIDRef.current,
        sequence: promptFocusSequence.current,
      })
    }, [])

    const followActiveLatest = useCallback(() => {
      followLatestSequence.current += 1
      setFollowLatestRequest({
        paneID: activePaneIDRef.current,
        sequence: followLatestSequence.current,
      })
    }, [])

    const newSession = useCallback(() => {
      updatePaneUIState(activePaneIDRef.current, {
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
      updatePaneUIState(activePaneIDRef.current, {
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
      }> = Array.from(paneUIStates.values()).flatMap((pane) => {
        if (
          pane.content?._tag !== "Session" ||
          restoredSessionIDs.current.has(pane.content.sessionID)
        )
          return []
        const sessionID = pane.content.sessionID
        const location = Array.from(props.locationStates.entries()).find(([, state]) =>
          state.snapshot === undefined
            ? false
            : state.snapshot.sessions.some((session) => session.id === sessionID) ||
              state.snapshot.recentSessions.some((session) => session.id === sessionID),
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
      paneUIStates,
      props.initialRestorationComplete,
      props.defaultLocationState.locationKey,
      props.defaultLocationState.status,
      props.locationStates,
      props.selectSession,
    ])

    useEffect(() => {
      const sessionID = props.defaultLocationState.requestedSessionID
      if (sessionID === undefined) return
      updatePaneUIState(activePaneIDRef.current, {
        content: { _tag: "Session", sessionID },
      })
    }, [props.defaultLocationState.requestedSessionID, updatePaneUIState])

    useEffect(() => {
      const timeout = window.setTimeout(persistProjectUIState, 300)
      return () => window.clearTimeout(timeout)
    }, [activePaneID, paneLayout, paneUIStates, persistProjectUIState])

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
            locationStates={props.locationStates}
            defaultLocationKey={locationKey}
            project={props.project}
            selectLocation={props.selectLocation}
            layout={paneLayout}
            activePaneID={activePaneID}
            promptFocusRequest={promptFocusRequest}
            followLatestRequest={followLatestRequest}
            landingError={props.defaultLocationState.landingError}
            setActivePane={setActivePaneID}
            setLayout={setPaneLayout}
            selectSession={props.selectSession}
            createSession={props.createSession}
            submitPrompt={props.submitPrompt}
            replyQuestion={props.replyQuestion}
            rejectQuestion={props.rejectQuestion}
            backgroundSession={props.backgroundSession}
            interruptSession={props.interruptSession}
            paneUIStates={paneUIStates}
            updatePaneUIState={updatePaneUIState}
          />
        </Profiler>
      </section>
    )
  },
)
