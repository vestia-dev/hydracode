import { useCallback, useEffect, useRef, useState } from "react"
import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react"
import { Effect } from "effect"
import { ProjectView } from "./components/ProjectView"
import { ProjectLanding } from "./components/ProjectLanding"
import { SettingsPage } from "./components/SettingsPage"
import { useUpdater } from "./hooks/useUpdater"
import { useProjectController } from "./hooks/useProjectController"
import { projectDisplayName, projectInitial } from "./projectors/projectPresentation"
import {
  adjacentPaneID,
  closePane,
  firstPaneID,
  initialPaneLayout,
  paneInDirection,
  paneSessionIDs,
  restorePaneLayout,
  savePaneLayout,
  setPaneSession,
  splitPane,
  type PaneLayout,
} from "./projectors/paneLayout"
import type { PaneDirection, PaneSplitCommand } from "../../shared/pane"
import { AppRuntime } from "./runtime"
import { DesktopBridge } from "./services/DesktopBridge"
import { DesktopBridgeError } from "./services/DesktopBridge"
import type { SavedLayout } from "../../shared/layout"

function updateLabel(state: ReturnType<typeof useUpdater>["state"]) {
  switch (state.status) {
    case "checking":
      return "Checking…"
    case "downloading":
      return `Downloading ${state.version}…`
    case "ready":
      return `Restart for ${state.version}`
    case "installing":
      return "Restarting…"
    case "up-to-date":
      return "Up to date"
    case "error":
      return "Update failed"
    default:
      return "Check for updates"
  }
}

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const {
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
    submitPrompt,
    interruptSession,
  } = useProjectController()
  const [paneLayout, setPaneLayout] = useState<PaneLayout>(() =>
    initialPaneLayout(crypto.randomUUID()),
  )
  const [activePaneID, setActivePaneID] = useState(() =>
    paneLayout._tag === "Pane" ? paneLayout.id : "",
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
  const projectStateRef = useRef(state)
  projectStateRef.current = state
  const [savedLayouts, setSavedLayouts] = useState<ReadonlyArray<SavedLayout>>([])
  const [savedLayoutsError, setSavedLayoutsError] = useState<string | null>(null)
  const [layoutStatus, setLayoutStatus] = useState<string | null>(null)
  const layoutSavePending = useRef(false)
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
  const saveCurrentLayout = useCallback(() => {
    const current = projectStateRef.current
    if (current._tag !== "Ready" || layoutSavePending.current) return
    layoutSavePending.current = true
    setLayoutStatus("Saving layout...")
    const layout = paneLayoutRef.current
    const sessionIDs = paneSessionIDs(layout)
    const titles = sessionIDs.map(
      (sessionID) =>
        current.snapshot.sessions.find((session) => session.id === sessionID)?.title ??
        current.snapshot.recentSessions.find((session) => session.id === sessionID)?.title ??
        "Session",
    )
    const name =
      titles.length === 0
        ? "Empty layout"
        : titles.length <= 2
          ? titles.join(" + ")
          : `${titles.slice(0, 2).join(" + ")} + ${titles.length - 2} more`
    AppRuntime.runFork(
      DesktopBridge.use((desktop) =>
        desktop.saveLayout({
          projectID: current.snapshot.project.id,
          name,
          layout: savePaneLayout(layout),
        }),
      ).pipe(
        Effect.tap((saved) =>
          Effect.sync(() => {
            layoutSavePending.current = false
            if (
              projectStateRef.current._tag !== "Ready" ||
              projectStateRef.current.snapshot.project.id !== current.snapshot.project.id
            )
              return
            setSavedLayouts((layouts) => [saved, ...layouts.filter((item) => item.id !== saved.id)])
            setSavedLayoutsError(null)
            setLayoutStatus("Layout saved")
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            layoutSavePending.current = false
            if (
              projectStateRef.current._tag === "Ready" &&
              projectStateRef.current.snapshot.project.id === current.snapshot.project.id
            )
              setLayoutStatus(error.message)
          }),
        ),
      ),
    )
  }, [])

  useEffect(() => {
    let remove: ReadonlyArray<() => void> | undefined
    let disposed = false
    void AppRuntime.runPromise(
      DesktopBridge.use((desktop) =>
        Effect.all([
          desktop.subscribePaneSplits(splitActivePane),
          desktop.subscribePaneFocus(focusPaneInDirection),
          desktop.subscribePaneClose(closeActivePane),
          desktop.subscribePromptFocus(focusActivePrompt),
          desktop.subscribeFollowLatest(followActiveLatest),
          desktop.subscribeLayoutSave(saveCurrentLayout),
        ]),
      ),
    ).then((unsubscribes) => {
      if (disposed) {
        for (const unsubscribe of unsubscribes) unsubscribe()
      } else remove = unsubscribes
    })
    return () => {
      disposed = true
      for (const unsubscribe of remove ?? []) unsubscribe()
    }
  }, [
    closeActivePane,
    focusActivePrompt,
    focusPaneInDirection,
    followActiveLatest,
    saveCurrentLayout,
    splitActivePane,
  ])

  const projectID = state._tag === "Ready" ? state.snapshot.project.id : undefined
  useEffect(() => {
    if (projectID === undefined) return
    const paneID = crypto.randomUUID()
    const layout = initialPaneLayout(paneID)
    paneLayoutRef.current = layout
    activePaneIDRef.current = paneID
    setPaneLayout(layout)
    setActivePaneID(paneID)
    setLayoutStatus(null)
    setSavedLayouts([])
    setSavedLayoutsError(null)
    layoutSavePending.current = false
    AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.listSavedLayouts(projectID)).pipe(
        Effect.tap((layouts) =>
          Effect.sync(() => {
            if (
              projectStateRef.current._tag === "Ready" &&
              projectStateRef.current.snapshot.project.id === projectID
            )
              setSavedLayouts(layouts)
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (
              projectStateRef.current._tag === "Ready" &&
              projectStateRef.current.snapshot.project.id === projectID
            )
              setSavedLayoutsError(error.message)
          }),
        ),
      ),
    )
  }, [projectID])
  const openSavedLayout = useCallback(
    (saved: SavedLayout) => {
      const layout = restorePaneLayout(saved.layout)
      if (layout === undefined)
        return Effect.fail(
          new DesktopBridgeError({
            message: "HydraCode could not restore this saved layout.",
            cause: saved.layout,
          }),
        )
      return Effect.forEach(paneSessionIDs(layout), selectSession, {
        concurrency: 4,
        discard: true,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            paneLayoutRef.current = layout
            const paneID = firstPaneID(layout)
            activePaneIDRef.current = paneID
            setPaneLayout(layout)
            setActivePaneID(paneID)
            setLayoutStatus(null)
          }),
        ),
      )
    },
    [selectSession],
  )
  const updater = useUpdater()
  const projectName =
    state._tag === "Ready"
      ? projectDisplayName(state.snapshot.project.name, state.snapshot.location.directory)
      : state._tag === "Loading"
        ? projectDisplayName(undefined, state.location.directory)
        : null
  const projectIcon =
    state._tag === "Ready"
      ? (state.snapshot.project.icon?.override ?? state.snapshot.project.icon?.url)
      : undefined
  const projectColor = state._tag === "Ready" ? state.snapshot.project.icon?.color : undefined
  const creatingSession =
    state._tag === "Ready" && state.snapshot.sessions.some((session) => session.provisional)

  return (
    <main className="project-shell">
      <header className="project-header">
        <div
          className="project-identity"
          title={state._tag === "Ready" ? state.snapshot.location.directory : undefined}
        >
          <span
            className="project-icon"
            style={{ backgroundColor: projectColor }}
            aria-hidden="true"
          >
            {projectIcon === undefined ? (
              <span>{projectInitial(projectName ?? "HydraCode")}</span>
            ) : (
              <img src={projectIcon} alt="" />
            )}
          </span>
          <span className="project-name">{projectName ?? "HydraCode"}</span>
        </div>
        <div className="header-actions">
          <span className="connection-state" role={layoutStatus === null ? undefined : "status"}>
            {layoutStatus ??
              (state._tag === "Ready"
                ? "Connected"
                : state._tag === "Loading"
                  ? "Connecting"
                  : "Not connected")}
          </span>
          {updater.state.status === "disabled" ? null : (
            <button
              type="button"
              className="update-button"
              disabled={
                updater.state.status === "checking" ||
                updater.state.status === "downloading" ||
                updater.state.status === "installing"
              }
              title={updater.state.status === "error" ? updater.state.message : undefined}
              onClick={updater.state.status === "ready" ? updater.install : updater.check}
            >
              {updateLabel(updater.state)}
            </button>
          )}
          {state._tag === "Ready" ? (
            <button
              type="button"
              className="open-project-button"
              disabled={creatingSession}
              onClick={() => {
                setShowSettings(false)
                setPaneLayout((current) => setPaneSession(current, activePaneID, undefined))
              }}
            >
              New session
            </button>
          ) : null}
          {state._tag === "Ready" ? (
            <button
              type="button"
              className="open-project-button"
              disabled={creatingSession}
              onClick={() => {
                setShowSettings(false)
                showProjects()
              }}
            >
              Projects
            </button>
          ) : null}
          <button
            type="button"
            className="settings-button"
            aria-label={showSettings ? "Close settings" : "Open settings"}
            aria-pressed={showSettings}
            title={showSettings ? "Close settings" : "Settings"}
            onClick={() => setShowSettings((current) => !current)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" />
              <path d="M19.1 13.6a7.7 7.7 0 0 0 .05-1.6 7.7 7.7 0 0 0-.05-1.6l1.75-1.35-1.8-3.1-2.05.85a7.6 7.6 0 0 0-2.75-1.6L14 3h-4l-.25 2.2A7.6 7.6 0 0 0 7 6.8l-2.05-.85-1.8 3.1L4.9 10.4a7.7 7.7 0 0 0-.05 1.6 7.7 7.7 0 0 0 .05 1.6l-1.75 1.35 1.8 3.1L7 17.2a7.6 7.6 0 0 0 2.75 1.6L10 21h4l.25-2.2A7.6 7.6 0 0 0 17 17.2l2.05.85 1.8-3.1L19.1 13.6Z" />
            </svg>
          </button>
        </div>
      </header>

      {showSettings ? (
        <SettingsPage />
      ) : state._tag === "Ready" ? (
        <ProjectView
          snapshot={state.snapshot}
          layout={paneLayout}
          activePaneID={activePaneID}
          promptFocusRequest={promptFocusRequest}
          followLatestRequest={followLatestRequest}
          promptRetry={promptRetry}
          landingError={landingError}
          savedLayouts={savedLayouts}
          savedLayoutsError={savedLayoutsError}
          setActivePane={setActivePaneID}
          setLayout={setPaneLayout}
          selectSession={selectSession}
          createSession={createSession}
          openSavedLayout={openSavedLayout}
          submitPrompt={submitPrompt}
          interruptSession={interruptSession}
        />
      ) : state._tag === "Loading" ? (
        <section className="session-pane" aria-label="Project status">
          <ReactFlow nodes={[]} edges={[]} fitView proOptions={{ hideAttribution: true }}>
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="var(--color-grid)"
            />
          </ReactFlow>

          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">
              H
            </span>
            <h1>Connecting to OpenCode</h1>
            <p>Loading sessions and their agent history…</p>
          </div>
        </section>
      ) : (
        <ProjectLanding
          catalog={catalog}
          error={state._tag === "Error" ? state.message : undefined}
          openProject={openProject}
          newProject={newProject}
          retry={loadProjects}
        />
      )}
    </main>
  )
}
