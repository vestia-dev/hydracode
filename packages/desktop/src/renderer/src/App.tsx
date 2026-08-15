import { useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber } from "effect"
import { Project } from "@opencode-ai/client/effect"
import { HomePage } from "./components/HomePage"
import { SettingsModal } from "./components/SettingsModal"
import { CommandMenu, type CommandMenuCommand } from "./components/CommandMenu"
import { LaunchScreen } from "./components/LaunchScreen"
import { ProjectContainer, type ProjectContainerHandle } from "./components/ProjectContainer"
import { useUpdater } from "./hooks/useUpdater"
import { useProjectController } from "./hooks/useProjectController"
import { projectDisplayName, projectInitial } from "./domain/projectPresentation"
import { AppRuntime } from "./runtime"
import { DesktopBridge } from "./services/DesktopBridge"
import { markStartup, markStartupAfterPaint, measureStartup } from "./startupTiming"
import type { ProjectUIState } from "../../shared/applicationState"

function updateLabel(state: ReturnType<typeof useUpdater>["state"]) {
  switch (state.status) {
    case "available":
      return "Update"
    case "downloading":
      return "Downloading..."
    case "ready":
      return "Restart"
    default:
      return null
  }
}

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandMenu, setShowCommandMenu] = useState(false)
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const projectSwitcherRef = useRef<HTMLDivElement>(null)
  const settingsReturnFocusRef = useRef<HTMLElement>(null)
  const commandMenuReturnFocusRef = useRef<HTMLElement>(null)
  const projectHandles = useRef(new Map<Project.ID, ProjectContainerHandle>())
  const projectUIStateCache = useRef(new Map<string, ProjectUIState>())
  const [launchDelayElapsed, setLaunchDelayElapsed] = useState(false)
  const [initialLaunchComplete, setInitialLaunchComplete] = useState(false)
  const [restoredProjectIDs, setRestoredProjectIDs] = useState<ReadonlySet<Project.ID>>(
    () => new Set(),
  )
  const [applicationStateReady, setApplicationStateReady] = useState(false)
  const {
    activeProjectID,
    openProjects,
    availableProjects,
    landingError,
    newProject,
    openProject,
    openHome,
    activateProject,
    selectSession,
    createSession,
    submitPrompt,
    replyQuestion,
    rejectQuestion,
    interruptSession,
  } = useProjectController()
  const activeRuntime = activeProjectID === null ? undefined : openProjects.get(activeProjectID)
  const orderedOpenProjects = Array.from(openProjects.values()).filter(
    (runtime) => runtime.projectID !== Project.ID.global,
  )
  const shortcutModifier = document.documentElement.dataset.platform === "macos" ? "⌘" : "Ctrl+"
  const activeHandle = () =>
    activeProjectID === null ? undefined : projectHandles.current.get(activeProjectID)

  useEffect(() => {
    markStartup("react-mounted")
    const fiber = AppRuntime.runFork(
      Effect.sleep("500 millis").pipe(
        Effect.tap(() => Effect.sync(() => setLaunchDelayElapsed(true))),
      ),
    )
    return () => {
      AppRuntime.runFork(Fiber.interrupt(fiber))
    }
  }, [])

  useEffect(() => {
    markStartup("application-state-load-start")
    AppRuntime.runFork(
      DesktopBridge.use((desktop) => desktop.loadApplicationState).pipe(
        Effect.tap((state) =>
          Effect.sync(() => {
            projectUIStateCache.current = new Map(
              state.projects.map((projectState) => [projectState.projectID, projectState]),
            )
            setApplicationStateReady(true)
            markStartup("application-state-ready")
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setApplicationStateReady(true)
            markStartup("application-state-ready")
          }),
        ),
      ),
    )
  }, [])

  useEffect(() => {
    if (!initialLaunchComplete) return undefined
    return markStartupAfterPaint("first-project-paint", true)
  }, [initialLaunchComplete])

  useEffect(() => {
    if (activeRuntime?.status === "ready") markStartup("project-snapshot-ready")
  }, [activeRuntime?.status])

  useEffect(() => {
    if (
      initialLaunchComplete ||
      !launchDelayElapsed ||
      !applicationStateReady ||
      availableProjects._tag === "Loading" ||
      (activeProjectID !== null &&
        activeRuntime?.status !== "error" &&
        !restoredProjectIDs.has(activeProjectID))
    )
      return
    setInitialLaunchComplete(true)
  }, [
    activeProjectID,
    activeRuntime,
    applicationStateReady,
    availableProjects._tag,
    initialLaunchComplete,
    launchDelayElapsed,
    restoredProjectIDs,
  ])

  const selectProject = useCallback(
    (project: Parameters<typeof openProject>[0]) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      setShowSettings(false)
      setShowProjectSwitcher(false)
      if (openProjects.has(project.project.id)) activateProject(project.project.id)
      else openProject(project)
    },
    [activateProject, openProject, openProjects],
  )

  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (!primaryModifier || event.altKey || event.shiftKey || event.key !== ",") return
      event.preventDefault()
      if (!showSettings)
        settingsReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      setShowCommandMenu(false)
      setShowProjectSwitcher(false)
      setShowSettings(true)
    }
    window.addEventListener("keydown", openSettings)
    return () => window.removeEventListener("keydown", openSettings)
  }, [showSettings])

  useEffect(() => {
    const openCommandMenu = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (
        !primaryModifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLocaleLowerCase() !== "p"
      )
        return
      event.preventDefault()
      if (!showCommandMenu)
        commandMenuReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      setShowSettings(false)
      setShowCommandMenu((current) => !current)
    }
    window.addEventListener("keydown", openCommandMenu)
    return () => window.removeEventListener("keydown", openCommandMenu)
  }, [showCommandMenu])

  useEffect(() => {
    const openProjectSwitcher = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (
        !primaryModifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLocaleLowerCase() !== "k"
      )
        return
      event.preventDefault()
      setShowCommandMenu(false)
      setShowSettings(false)
      setShowProjectSwitcher(true)
    }
    window.addEventListener("keydown", openProjectSwitcher)
    return () => window.removeEventListener("keydown", openProjectSwitcher)
  }, [])

  useEffect(() => {
    if (!showProjectSwitcher) return undefined
    const frame = window.requestAnimationFrame(() => {
      const menu = projectSwitcherRef.current?.querySelector<HTMLElement>(
        '.project-switcher__menu [role="menuitem"][aria-current="true"]',
      )
      const first = projectSwitcherRef.current?.querySelector<HTMLElement>(
        '.project-switcher__menu [role="menuitem"]',
      )
      ;(menu ?? first)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showProjectSwitcher])

  useEffect(() => {
    if (!showProjectSwitcher) return undefined
    const closeProjectSwitcher = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return
      } else if (event.target instanceof Node && projectSwitcherRef.current?.contains(event.target))
        return
      setShowProjectSwitcher(false)
    }
    window.addEventListener("mousedown", closeProjectSwitcher)
    window.addEventListener("keydown", closeProjectSwitcher)
    return () => {
      window.removeEventListener("mousedown", closeProjectSwitcher)
      window.removeEventListener("keydown", closeProjectSwitcher)
    }
  }, [showProjectSwitcher])

  useEffect(() => {
    const openProjectByPosition = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (!primaryModifier || event.altKey || event.shiftKey || !/^[1-9]$/u.test(event.key)) return
      const project = orderedOpenProjects[Number(event.key) - 1]
      if (project === undefined) return
      event.preventDefault()
      activateProject(project.projectID)
    }
    window.addEventListener("keydown", openProjectByPosition)
    return () => window.removeEventListener("keydown", openProjectByPosition)
  }, [activateProject, orderedOpenProjects])

  useEffect(() => {
    let remove: ReadonlyArray<() => void> | undefined
    let disposed = false
    void AppRuntime.runPromise(
      DesktopBridge.use((desktop) =>
        Effect.all([
          desktop.subscribePaneSplits((command) => activeHandle()?.split(command)),
          desktop.subscribePaneFocus((direction) => activeHandle()?.focus(direction)),
          desktop.subscribePaneClose(() => activeHandle()?.closePane()),
          desktop.subscribePromptFocus(() => activeHandle()?.focusPrompt()),
          desktop.subscribeFollowLatest(() => activeHandle()?.followLatest()),
        ]),
      ),
    ).then((unsubscribes) => {
      if (disposed) for (const unsubscribe of unsubscribes) unsubscribe()
      else remove = unsubscribes
    })
    return () => {
      disposed = true
      for (const unsubscribe of remove ?? []) unsubscribe()
    }
  }, [activeProjectID])

  const updater = useUpdater()
  const projectName =
    activeProjectID === Project.ID.global
      ? "Home"
      : activeRuntime?.snapshot === undefined
        ? activeRuntime === undefined
          ? null
          : projectDisplayName(undefined, activeRuntime.location.directory)
        : projectDisplayName(
            activeRuntime.snapshot.project.name,
            activeRuntime.snapshot.location.directory,
          )
  const projectIcon =
    activeRuntime?.snapshot?.project.icon?.override ?? activeRuntime?.snapshot?.project.icon?.url
  const projectColor = activeRuntime?.snapshot?.project.icon?.color
  const projectSwitcherLabel = projectName ?? "Projects"
  const projectReady = activeRuntime?.status === "ready"
  const creatingSession =
    activeRuntime?.snapshot?.sessions.some((session) => session.provisional) ?? false
  const showProject = (action: () => void) => () => {
    setShowSettings(false)
    action()
  }
  const commandMenuCommands: ReadonlyArray<CommandMenuCommand> = [
    {
      id: "new-session",
      disabled: !projectReady || creatingSession,
      run: showProject(() => activeHandle()?.newSession()),
    },
    {
      id: "open-project",
      run: () => undefined,
    },
    {
      id: "toggle-settings",
      run: () => {
        settingsReturnFocusRef.current = commandMenuReturnFocusRef.current
        setShowSettings(true)
      },
    },
    ...(["right", "down", "left", "up"] as const).map((direction) => ({
      id: `split-pane-${direction}` as CommandMenuCommand["id"],
      disabled: !projectReady,
      run: showProject(() => activeHandle()?.split(direction)),
    })),
    ...(["left", "down", "up", "right"] as const).map((direction) => ({
      id: `focus-pane-${direction}` as CommandMenuCommand["id"],
      disabled: !projectReady,
      run: showProject(() => activeHandle()?.focus(direction)),
    })),
    {
      id: "focus-prompt",
      disabled: !projectReady,
      run: showProject(() => activeHandle()?.focusPrompt()),
    },
    {
      id: "follow-latest-node",
      disabled: !projectReady,
      run: showProject(() => activeHandle()?.followLatest()),
    },
    {
      id: "close-pane",
      disabled: !projectReady,
      run: showProject(() => activeHandle()?.closePane()),
    },
  ]

  return (
    <main className="project-shell">
      {initialLaunchComplete ? null : <LaunchScreen />}
      {showCommandMenu ? (
        <CommandMenu
          commands={commandMenuCommands}
          close={() => setShowCommandMenu(false)}
          projects={availableProjects._tag === "Ready" ? availableProjects.projects : []}
          projectsLoading={false}
          projectsError={availableProjects._tag === "Error" ? availableProjects.message : undefined}
          chooseFolder={newProject}
          openProject={selectProject}
        />
      ) : null}
      <header className="project-header">
        <div ref={projectSwitcherRef} className="project-switcher">
          <button
            type="button"
            className="project-identity"
            disabled={orderedOpenProjects.length === 0}
            title={activeRuntime?.location.directory ?? "Open projects"}
            aria-haspopup="menu"
            aria-expanded={showProjectSwitcher}
            onClick={() => setShowProjectSwitcher((current) => !current)}
          >
            <span
              className="project-icon"
              style={{ backgroundColor: projectColor }}
              aria-hidden="true"
            >
              {projectIcon === undefined ? (
                <span>{projectInitial(projectSwitcherLabel)}</span>
              ) : (
                <img src={projectIcon} alt="" />
              )}
            </span>
            <span className="project-name">{projectSwitcherLabel}</span>
            <svg className="project-switcher__chevrons" viewBox="0 0 12 16" aria-hidden="true">
              <path d="m3 6 3-3 3 3M3 10l3 3 3-3" />
            </svg>
          </button>
          {showProjectSwitcher ? (
            <div
              className="project-switcher__menu"
              role="menu"
              aria-label="Open projects"
              onKeyDown={(event) => {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                )
                if (buttons.length === 0) return
                const current = buttons.findIndex((button) => button === document.activeElement)
                let next: number | undefined
                if (event.key === "ArrowDown" || event.key === "ArrowRight")
                  next = (current + 1) % buttons.length
                else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
                  next = (current - 1 + buttons.length) % buttons.length
                else if (event.key === "Home") next = 0
                else if (event.key === "End") next = buttons.length - 1
                if (next === undefined) return
                event.preventDefault()
                buttons[next]?.focus()
              }}
            >
              {orderedOpenProjects.length === 0 ? (
                <span className="project-switcher__status">No open projects</span>
              ) : (
                orderedOpenProjects.map((runtime, shortcutIndex) => {
                  const project = runtime.snapshot?.project
                  const location = runtime.snapshot?.location ?? runtime.location
                  const name = projectDisplayName(project?.name, location.directory)
                  const icon = project?.icon?.override ?? project?.icon?.url
                  const current = runtime.projectID === activeProjectID
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      key={runtime.projectID}
                      aria-current={current ? "true" : undefined}
                      onClick={() => {
                        setShowProjectSwitcher(false)
                        activateProject(runtime.projectID)
                      }}
                    >
                      <span
                        className="project-icon project-switcher__icon"
                        style={{ backgroundColor: project?.icon?.color }}
                        aria-hidden="true"
                      >
                        {icon === undefined ? (
                          <span>{projectInitial(name)}</span>
                        ) : (
                          <img src={icon} alt="" />
                        )}
                      </span>
                      <span className="project-switcher__copy">
                        <strong>{name}</strong>
                        <small>{location.directory}</small>
                      </span>
                      <span className="project-switcher__meta">
                        {shortcutIndex !== undefined && shortcutIndex < 9 ? (
                          <kbd>{`${shortcutModifier}${shortcutIndex + 1}`}</kbd>
                        ) : null}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          ) : null}
        </div>
        <div className="header-actions">
          {updateLabel(updater.state) === null ? null : (
            <button
              type="button"
              className="update-button"
              disabled={updater.state.status === "downloading"}
              title={
                updater.state.status === "available" || updater.state.status === "ready"
                  ? `HydraCode ${updater.state.version}`
                  : undefined
              }
              onClick={updater.state.status === "ready" ? updater.restart : updater.install}
            >
              {updateLabel(updater.state)}
            </button>
          )}
        </div>
      </header>

      <div className="project-layers">
        {showSettings ? (
          <SettingsModal
            close={() => setShowSettings(false)}
            returnFocus={settingsReturnFocusRef.current}
          />
        ) : null}
        <div className="project-stack" inert={showSettings}>
          {applicationStateReady
            ? Array.from(openProjects.values()).map((runtime) => (
                <ProjectContainer
                  key={runtime.projectID}
                  ref={(handle) => {
                    if (handle === null) projectHandles.current.delete(runtime.projectID)
                    else projectHandles.current.set(runtime.projectID, handle)
                  }}
                  runtime={runtime}
                  active={runtime.projectID === activeProjectID}
                  initialUIState={projectUIStateCache.current.get(runtime.projectID)}
                  initialRestorationComplete={() =>
                    setRestoredProjectIDs((current) => {
                      if (current.has(runtime.projectID)) return current
                      if (runtime.projectID === activeProjectID) {
                        markStartup("session-restoration-ready")
                        measureStartup(
                          "session-restoration",
                          "session-restoration-start",
                          "session-restoration-ready",
                        )
                      }
                      return new Set(current).add(runtime.projectID)
                    })
                  }
                  uiStateCache={projectUIStateCache}
                  selectSession={selectSession}
                  createSession={createSession}
                  submitPrompt={submitPrompt}
                  replyQuestion={replyQuestion}
                  rejectQuestion={rejectQuestion}
                  interruptSession={interruptSession}
                />
              ))
            : null}
          {activeRuntime?.status === "opening" || !applicationStateReady ? (
            <section
              className="session-pane project-layer project-loading"
              aria-label="Project status"
            >
              <div className="empty-state">
                <span className="empty-mark" aria-hidden="true">
                  H
                </span>
                <h1>Connecting to OpenCode</h1>
                <p>Loading sessions and their agent history...</p>
              </div>
            </section>
          ) : activeRuntime?.status === "error" || activeRuntime === undefined ? (
            <HomePage error={activeRuntime?.error ?? landingError} createSession={openHome} />
          ) : null}
        </div>
      </div>
    </main>
  )
}
