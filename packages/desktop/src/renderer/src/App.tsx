import { useCallback, useEffect, useRef, useState } from "react"
import { Effect, Fiber } from "effect"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import { GlobalProjectPage } from "./components/GlobalProjectPage"
import { SettingsModal } from "./components/SettingsModal"
import { CommandMenu, type CommandMenuCommand } from "./components/CommandMenu"
import { LaunchScreen } from "./components/LaunchScreen"
import { ProjectContainer, type ProjectContainerHandle } from "./components/ProjectContainer"
import { useUpdater } from "./hooks/useUpdater"
import { useProjectController } from "./hooks/useProjectController"
import type { OpenLocationState } from "./domain/projectLocationState"
import { projectDisplayName, projectInitial } from "./domain/projectPresentation"
import { AppRuntime } from "./runtime"
import { DesktopBridge } from "./services/DesktopBridge"
import { markStartup, markStartupAfterPaint, measureStartup } from "./startupTiming"
import type { ProjectUIState } from "../../shared/applicationState"
import type { ProjectCatalogEntry } from "../../shared/project"
import { locationKey } from "../../shared/domain/projectCatalog"

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

type AppOverlayState = "none" | "settings" | "command-menu" | "project-switcher"

export function App() {
  const [overlay, setOverlay] = useState<AppOverlayState>("none")
  const projectSwitcherRef = useRef<HTMLDivElement>(null)
  const settingsReturnFocusRef = useRef<HTMLElement>(null)
  const commandMenuReturnFocusRef = useRef<HTMLElement>(null)
  const projectHandles = useRef(new Map<string, ProjectContainerHandle>())
  const projectUIStateCache = useRef(new Map<string, ProjectUIState>())
  const [launchDelayElapsed, setLaunchDelayElapsed] = useState(false)
  const [initialLaunchComplete, setInitialLaunchComplete] = useState(false)
  const [restoredLocationKeys, setRestoredLocationKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [projectLocationRecency, setProjectLocationRecency] = useState<
    ReadonlyMap<Project.ID, string>
  >(() => new Map())
  const {
    activeLocationKey,
    openLocations,
    sessions,
    availableProjects,
    restoredProjectUIStates,
    initialStateResolved,
    landingError,
    newProject,
    openLocation,
    ensureLocation,
    openGlobalProject,
    activateLocation,
    selectSession,
    createSession,
    submitPrompt,
    updateSessionInbox,
    replyQuestion,
    rejectQuestion,
    backgroundSession,
    interruptSession,
  } = useProjectController()
  useEffect(() => {
    if (restoredProjectUIStates.length === 0) return
    for (const projectState of restoredProjectUIStates)
      projectUIStateCache.current.set(projectState.locationKey, projectState)
  }, [restoredProjectUIStates])
  const activeLocationState =
    activeLocationKey === null ? undefined : openLocations.get(activeLocationKey)
  const openProjectOrder = new Map<Project.ID, number>()
  for (const state of openLocations.values()) {
    if (!openProjectOrder.has(state.projectID))
      openProjectOrder.set(state.projectID, openProjectOrder.size)
  }
  const orderedOpenProjects = Array.from(openLocations.values())
    .filter((state) => state.projectID !== Project.ID.global)
    .filter(
      (state, index, states) =>
        states.findIndex((candidate) => candidate.projectID === state.projectID) === index,
    )
    .toSorted(
      (left, right) =>
        (openProjectOrder.get(left.projectID) ?? 0) - (openProjectOrder.get(right.projectID) ?? 0),
    )
  const globalLocationState = Array.from(openLocations.values()).find(
    (state) => state.projectID === Project.ID.global,
  )
  const globalProject = (availableProjects._tag === "Ready"
    ? availableProjects.projects.find((project) => project.project.id === Project.ID.global)
    : undefined) ?? {
    project: { id: Project.ID.global, canonical: AbsolutePath.make("/") },
    locations: [
      {
        ref: Location.Ref.make({ directory: AbsolutePath.make("/") }),
        kind: "canonical",
      },
    ],
    updated: 0,
  }
  const shortcutModifier = document.documentElement.dataset.platform === "macos" ? "⌘" : "Ctrl+"
  const activeHandle = () =>
    activeLocationState === undefined
      ? undefined
      : projectHandles.current.get(activeLocationState.projectID)

  useEffect(() => {
    if (activeLocationState === undefined) return
    setProjectLocationRecency((current) => {
      if (current.get(activeLocationState.projectID) === activeLocationState.locationKey)
        return current
      return new Map(current).set(activeLocationState.projectID, activeLocationState.locationKey)
    })
  }, [activeLocationState])

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
    if (!initialLaunchComplete) return undefined
    markStartup("launch-completion-committed")
    measureStartup(
      "launch-completion-commit",
      "launch-completion-requested",
      "launch-completion-committed",
    )
    return markStartupAfterPaint("first-project-paint", true, "launch-completion-committed")
  }, [initialLaunchComplete])

  useEffect(() => {
    if (activeLocationState?.status === "ready") markStartup("project-open-ready")
  }, [activeLocationState?.status])

  useEffect(() => {
    if (
      initialLaunchComplete ||
      !launchDelayElapsed ||
      !initialStateResolved ||
      availableProjects._tag === "Loading" ||
      (activeLocationKey !== null &&
        activeLocationState?.status !== "error" &&
        !restoredLocationKeys.has(activeLocationKey))
    )
      return
    markStartup("launch-completion-requested")
    setInitialLaunchComplete(true)
  }, [
    activeLocationKey,
    activeLocationState,
    initialStateResolved,
    availableProjects._tag,
    initialLaunchComplete,
    launchDelayElapsed,
    restoredLocationKeys,
  ])

  const selectProject = useCallback(
    (
      project: Parameters<typeof openLocation>[0],
      _persist = true,
      selectedLocation?: Location.Ref,
    ) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      setOverlay("none")
      const rememberedKey = projectLocationRecency.get(project.project.id)
      const location =
        selectedLocation ??
        project.locations.find((candidate) => locationKey(candidate.ref) === rememberedKey)?.ref ??
        project.locations.find((candidate) => candidate.kind === "canonical")?.ref
      if (location !== undefined && openLocations.has(locationKey(location)))
        activateLocation(locationKey(location))
      else openLocation(project, _persist, location)
    },
    [activateLocation, openLocation, openLocations, projectLocationRecency],
  )

  useEffect(() => {
    const openSettings = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (!primaryModifier || event.altKey || event.shiftKey || event.key !== ",") return
      event.preventDefault()
      if (overlay !== "settings")
        settingsReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOverlay("settings")
    }
    window.addEventListener("keydown", openSettings)
    return () => window.removeEventListener("keydown", openSettings)
  }, [overlay])

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
      if (overlay !== "command-menu")
        commandMenuReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOverlay((current) => (current === "command-menu" ? "none" : "command-menu"))
    }
    window.addEventListener("keydown", openCommandMenu)
    return () => window.removeEventListener("keydown", openCommandMenu)
  }, [overlay])

  useEffect(() => {
    const openLocationSwitcher = (event: KeyboardEvent) => {
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
      setOverlay("project-switcher")
    }
    window.addEventListener("keydown", openLocationSwitcher)
    return () => window.removeEventListener("keydown", openLocationSwitcher)
  }, [])

  useEffect(() => {
    if (overlay !== "project-switcher") return undefined
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
  }, [overlay])

  useEffect(() => {
    if (overlay !== "project-switcher") return undefined
    const closeLocationSwitcher = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return
      } else if (event.target instanceof Node && projectSwitcherRef.current?.contains(event.target))
        return
      setOverlay("none")
    }
    window.addEventListener("mousedown", closeLocationSwitcher)
    window.addEventListener("keydown", closeLocationSwitcher)
    return () => {
      window.removeEventListener("mousedown", closeLocationSwitcher)
      window.removeEventListener("keydown", closeLocationSwitcher)
    }
  }, [overlay])

  useEffect(() => {
    const openLocationByPosition = (event: KeyboardEvent) => {
      const primaryModifier =
        document.documentElement.dataset.platform === "macos" ? event.metaKey : event.ctrlKey
      if (!primaryModifier || event.altKey || event.shiftKey || !/^[1-9]$/u.test(event.key)) return
      const project = orderedOpenProjects[Number(event.key) - 1]
      if (project === undefined) return
      event.preventDefault()
      activateLocation(projectLocationRecency.get(project.projectID) ?? project.locationKey)
    }
    window.addEventListener("keydown", openLocationByPosition)
    return () => window.removeEventListener("keydown", openLocationByPosition)
  }, [activateLocation, orderedOpenProjects, projectLocationRecency])

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
  }, [activeLocationKey])

  const updater = useUpdater()
  const projectName =
    activeLocationState?.projectID === Project.ID.global
      ? "Global"
      : activeLocationState?.snapshot === undefined
        ? activeLocationState === undefined
          ? null
          : projectDisplayName(
              undefined,
              availableProjects._tag === "Ready"
                ? (availableProjects.projects.find(
                    (project) => project.project.id === activeLocationState.projectID,
                  )?.project.canonical ?? activeLocationState.location.directory)
                : activeLocationState.location.directory,
            )
        : projectDisplayName(
            activeLocationState.snapshot.project.name,
            activeLocationState.snapshot.project.canonical,
          )
  const projectIcon =
    activeLocationState?.snapshot?.project.icon?.override ??
    activeLocationState?.snapshot?.project.icon?.url
  const projectColor = activeLocationState?.snapshot?.project.icon?.color
  const globalProjectActive = activeLocationState?.projectID === Project.ID.global
  const projectSwitcherLabel = projectName ?? "Projects"
  const projectReady = activeLocationState?.status === "ready"
  const catalogForLocation = (state: OpenLocationState | undefined): ProjectCatalogEntry => {
    if (state === undefined) {
      return globalProject
    }
    const catalog =
      availableProjects._tag === "Ready"
        ? availableProjects.projects.find((project) => project.project.id === state.projectID)
        : undefined
    return (
      catalog ?? {
        project: state.snapshot?.project ?? {
          id: state.projectID,
          canonical: state.location.directory,
        },
        locations: [{ ref: state.location, kind: "selected" }],
        updated: 0,
      }
    )
  }
  const creatingSession = Array.from(sessions.values()).some(
    (session) =>
      session.provisional &&
      activeLocationState !== undefined &&
      session.location.directory === activeLocationState.location.directory &&
      session.location.workspaceID === activeLocationState.location.workspaceID,
  )
  const showProject = (action: () => void) => () => {
    setOverlay("none")
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
      id: "save-prompt",
      run: () => undefined,
    },
    {
      id: "view-saved-prompts",
      run: () => undefined,
    },
    {
      id: "toggle-settings",
      run: () => {
        settingsReturnFocusRef.current = commandMenuReturnFocusRef.current
        setOverlay("settings")
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
      {overlay === "command-menu" ? (
        <CommandMenu
          commands={commandMenuCommands}
          close={() => setOverlay("none")}
          projects={availableProjects._tag === "Ready" ? availableProjects.projects : []}
          projectsLoading={false}
          projectsError={availableProjects._tag === "Error" ? availableProjects.message : undefined}
          chooseFolder={newProject}
          openProject={selectProject}
          listSavedPrompts={() =>
            AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.listSavedPrompts))
          }
          savePrompt={(text) =>
            AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.savePrompt(text)))
          }
          copyPrompt={(text) =>
            AppRuntime.runPromise(DesktopBridge.use((desktop) => desktop.copyPrompt(text)))
          }
        />
      ) : null}
      <header className="project-header">
        <div ref={projectSwitcherRef} className="project-switcher">
          <button
            type="button"
            className="project-identity"
            title={
              activeLocationState?.snapshot?.project.canonical ??
              (availableProjects._tag === "Ready"
                ? availableProjects.projects.find(
                    (project) => project.project.id === activeLocationState?.projectID,
                  )?.project.canonical
                : undefined) ??
              "Open projects"
            }
            aria-haspopup="menu"
            aria-expanded={overlay === "project-switcher"}
            onClick={() =>
              setOverlay((current) =>
                current === "project-switcher" ? "none" : "project-switcher",
              )
            }
          >
            <span
              className="project-icon"
              style={{ backgroundColor: projectColor }}
              aria-hidden="true"
            >
              {globalProjectActive ? (
                <svg className="project-icon__globe" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M2.5 8h11M8 2.5c1.7 1.5 2.5 3.3 2.5 5.5S9.7 12 8 13.5C6.3 12 5.5 10.2 5.5 8S6.3 4 8 2.5Z" />
                </svg>
              ) : projectIcon === undefined ? (
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
          {overlay === "project-switcher" ? (
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
              <>
                {orderedOpenProjects.map((state, shortcutIndex) => {
                  const project = state.snapshot?.project
                  const catalog = catalogForLocation(state)
                  const rememberedLocationKey = projectLocationRecency.get(state.projectID)
                  const locationState = openLocations.get(rememberedLocationKey ?? "") ?? state
                  const name = projectDisplayName(
                    project?.name,
                    catalog.project.canonical,
                    state.projectID,
                  )
                  const icon = project?.icon?.override ?? project?.icon?.url
                  const current = state.projectID === activeLocationState?.projectID
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      key={`switcher-${state.projectID}`}
                      aria-current={current ? "true" : undefined}
                      onClick={() => {
                        setOverlay("none")
                        activateLocation(locationState.locationKey)
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
                        <small>Open project</small>
                      </span>
                      <span className="project-switcher__meta">
                        {shortcutIndex < 9 ? (
                          <kbd>{`${shortcutModifier}${shortcutIndex + 1}`}</kbd>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  role="menuitem"
                  aria-current={
                    globalLocationState?.locationKey === activeLocationKey ? "true" : undefined
                  }
                  onClick={() => {
                    setOverlay("none")
                    if (globalLocationState !== undefined)
                      activateLocation(globalLocationState.locationKey)
                    else openLocation(globalProject)
                  }}
                >
                  <span className="project-icon project-switcher__icon" aria-hidden="true">
                    <svg className="project-icon__globe" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="5.5" />
                      <path d="M2.5 8h11M8 2.5c1.7 1.5 2.5 3.3 2.5 5.5S9.7 12 8 13.5C6.3 12 5.5 10.2 5.5 8S6.3 4 8 2.5Z" />
                    </svg>
                  </span>
                  <span className="project-switcher__copy">
                    <strong>Global</strong>
                    <small>Global project</small>
                  </span>
                </button>
              </>
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
        {overlay === "settings" ? (
          <SettingsModal
            close={() => setOverlay("none")}
            returnFocus={settingsReturnFocusRef.current}
          />
        ) : null}
        <div className="project-stack" inert={overlay === "settings"}>
          {initialStateResolved
            ? [
                ...orderedOpenProjects,
                ...(globalLocationState === undefined ? [] : [globalLocationState]),
              ].map((projectState) => {
                const rememberedLocationKey = projectLocationRecency.get(projectState.projectID)
                const defaultLocationState =
                  openLocations.get(rememberedLocationKey ?? "") ?? projectState
                const projectLocations = new Map(
                  Array.from(openLocations.entries()).filter(
                    ([, state]) => state.projectID === projectState.projectID,
                  ),
                )
                const project = catalogForLocation(defaultLocationState)
                return (
                  <ProjectContainer
                    key={projectState.projectID}
                    ref={(handle) => {
                      if (handle === null) projectHandles.current.delete(projectState.projectID)
                      else projectHandles.current.set(projectState.projectID, handle)
                    }}
                    defaultLocationState={defaultLocationState}
                    locationStates={projectLocations}
                    sessions={sessions}
                    project={project}
                    selectLocation={(location) => ensureLocation(project, location)}
                    active={projectState.projectID === activeLocationState?.projectID}
                    initialUIState={
                      projectUIStateCache.current.get(defaultLocationState.locationKey) ??
                      restoredProjectUIStates.find(
                        (state) => state.projectID === projectState.projectID,
                      )
                    }
                    initialRestorationComplete={() =>
                      setRestoredLocationKeys((current) => {
                        if (current.has(defaultLocationState.locationKey)) return current
                        if (projectState.projectID === activeLocationState?.projectID) {
                          markStartup("session-restoration-ready")
                          measureStartup(
                            "session-restoration",
                            "session-restoration-start",
                            "session-restoration-ready",
                          )
                        }
                        return new Set(current).add(defaultLocationState.locationKey)
                      })
                    }
                    uiStateCache={projectUIStateCache}
                    selectSession={selectSession}
                    createSession={createSession}
                    submitPrompt={submitPrompt}
                    updateSessionInbox={updateSessionInbox}
                    replyQuestion={replyQuestion}
                    rejectQuestion={rejectQuestion}
                    backgroundSession={backgroundSession}
                    interruptSession={interruptSession}
                  />
                )
              })
            : null}
          {activeLocationState?.status === "opening" || !initialStateResolved ? (
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
          ) : activeLocationState?.status === "error" || activeLocationState === undefined ? (
            <GlobalProjectPage
              error={activeLocationState?.error ?? landingError}
              createSession={openGlobalProject}
            />
          ) : null}
        </div>
      </div>
    </main>
  )
}
