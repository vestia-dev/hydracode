import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Effect } from "effect"
import { Project, type Question } from "@opencode-ai/client/effect"
import { ProjectView } from "./ProjectView"
import {
  adjacentPaneID,
  closePane,
  firstPaneID,
  hasPane,
  initialPaneLayout,
  paneInDirection,
  paneSessionIDs,
  restorePaneLayout,
  savePaneLayout,
  setPaneSession,
  splitPane,
  type PaneLayout,
} from "../domain/paneLayout"
import type { PaneDirection, PaneSplitCommand } from "../../../shared/pane"
import type { PaneUIState, ProjectUIState } from "../../../shared/applicationState"
import type { OpenProjectRuntime } from "../hooks/useProjectController"
import type { SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge } from "../services/DesktopBridge"
import {
  DesktopBridge as DesktopBridgeService,
  DesktopBridgeError,
} from "../services/DesktopBridge"
import { AppRuntime } from "../runtime"
import { markStartup, recordStartupMeasure } from "../startupTiming"

export interface ProjectContainerHandle {
  readonly split: (command: PaneSplitCommand) => void
  readonly focus: (direction: PaneDirection) => void
  readonly closePane: () => void
  readonly focusPrompt: () => void
  readonly followLatest: () => void
  readonly newSession: () => void
}

interface ProjectContainerProps {
  readonly runtime: OpenProjectRuntime
  readonly active: boolean
  readonly initialUIState: ProjectUIState | undefined
  readonly initialRestorationComplete: () => void
  readonly uiStateCache: React.MutableRefObject<Map<string, ProjectUIState>>
  readonly selectSession: (
    projectID: Project.ID,
    sessionID: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly createSession: (
    projectID: Project.ID,
    text: string,
    selectCreated?: (sessionID: SessionView["id"] | undefined) => void,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly submitPrompt: (
    projectID: Project.ID,
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly replyQuestion: (
    projectID: Project.ID,
    request: Question.Request,
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly rejectQuestion: (
    projectID: Project.ID,
    request: Question.Request,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    projectID: Project.ID,
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
    const runtimeRef = useRef(props.runtime)
    runtimeRef.current = props.runtime
    const restorationStarted = useRef(false)
    const [paneUIStates, setPaneUIStates] = useState<ReadonlyMap<string, PaneUIState>>(
      () =>
        new Map(
          (restoredLayout === undefined ? [] : (props.initialUIState?.panes ?? [])).map((pane) => [
            pane.paneID,
            pane,
          ]),
        ),
    )
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
      const runtime = runtimeRef.current
      if (runtime.snapshot === undefined || runtime.projectID === Project.ID.global) return
      const state: ProjectUIState = {
        projectID: runtime.projectID,
        activePaneID: activePaneIDRef.current,
        layout: savePaneLayout(paneLayoutRef.current),
        panes: Array.from(paneUIStatesRef.current.values()),
        updated: Date.now(),
      }
      props.uiStateCache.current.set(runtime.projectID, state)
      AppRuntime.runFork(
        DesktopBridgeService.use((desktop) => desktop.saveProjectUIState(state)).pipe(
          Effect.catch(() => Effect.void),
        ),
      )
    }, [props.uiStateCache])

    const splitActivePane = useCallback((command: PaneSplitCommand) => {
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
      setPaneLayout(next)
      setActivePaneID(newPaneID)
    }, [])

    const closeActivePane = useCallback(() => {
      const current = paneLayoutRef.current
      const paneID = activePaneIDRef.current
      const next = closePane(current, paneID)
      if (next === current) return
      const nextPaneID = adjacentPaneID(current, paneID) ?? firstPaneID(next)
      paneLayoutRef.current = next
      activePaneIDRef.current = nextPaneID
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
      setPaneLayout((current) => setPaneSession(current, activePaneIDRef.current, undefined))
    }, [])

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
      if (props.runtime.status !== "ready" || restorationStarted.current) return
      restorationStarted.current = true
      if (props.active) markStartup("session-restoration-start")
      const projectID = props.runtime.projectID
      AppRuntime.runFork(
        (restoredLayout === undefined
          ? Effect.void
          : Effect.forEach(
              paneSessionIDs(restoredLayout),
              (sessionID) => {
                const started = performance.now()
                return props.selectSession(projectID, sessionID).pipe(
                  Effect.ensuring(
                    Effect.sync(() => recordStartupMeasure("session-selection", started)),
                  ),
                  Effect.catch(() => Effect.void),
                )
              },
              { concurrency: 4, discard: true },
            )
        ).pipe(Effect.ensuring(Effect.sync(props.initialRestorationComplete))),
      )
    }, [
      props.initialRestorationComplete,
      props.runtime.projectID,
      props.runtime.status,
      props.selectSession,
    ])

    useEffect(() => {
      const sessionID = props.runtime.requestedSessionID
      if (sessionID === undefined) return
      setPaneLayout((current) => setPaneSession(current, activePaneIDRef.current, sessionID))
    }, [props.runtime.requestedSessionID])

    useEffect(() => {
      const timeout = window.setTimeout(persistProjectUIState, 300)
      return () => window.clearTimeout(timeout)
    }, [activePaneID, paneLayout, paneUIStates, persistProjectUIState])

    useEffect(() => () => persistProjectUIState(), [persistProjectUIState])

    if (props.runtime.snapshot === undefined) return null
    const projectID = props.runtime.projectID
    return (
      <section className="project-layer" inert={!props.active} data-active={props.active}>
        <ProjectView
          snapshot={props.runtime.snapshot}
          layout={paneLayout}
          activePaneID={activePaneID}
          promptFocusRequest={promptFocusRequest}
          followLatestRequest={followLatestRequest}
          promptRetry={props.runtime.promptRetry}
          landingError={props.runtime.landingError}
          setActivePane={setActivePaneID}
          setLayout={setPaneLayout}
          selectSession={(sessionID) => props.selectSession(projectID, sessionID)}
          createSession={(text, selectCreated) =>
            props.createSession(projectID, text, selectCreated)
          }
          submitPrompt={(sessionID, text) => props.submitPrompt(projectID, sessionID, text)}
          replyQuestion={(request, answers) => props.replyQuestion(projectID, request, answers)}
          rejectQuestion={(request) => props.rejectQuestion(projectID, request)}
          interruptSession={(sessionID) => props.interruptSession(projectID, sessionID)}
          paneUIStates={paneUIStates}
          updatePaneUIState={updatePaneUIState}
        />
      </section>
    )
  },
)
