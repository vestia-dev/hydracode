import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react"
import { ProjectView } from "./components/ProjectView"
import { ProjectLanding } from "./components/ProjectLanding"
import { SessionLanding } from "./components/SessionLanding"
import { useUpdater } from "./hooks/useUpdater"
import { useProjectController } from "./hooks/useProjectController"
import { projectDisplayName, projectInitial } from "./projectors/projectPresentation"

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
    showSessionLanding,
    submitPrompt,
    interruptSession,
  } = useProjectController()
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
          <span className="connection-state">
            {state._tag === "Ready"
              ? "Connected"
              : state._tag === "Loading"
                ? "Connecting"
                : "Not connected"}
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
          {state._tag === "Ready" && state.screen === "session" ? (
            <button
              type="button"
              className="open-project-button"
              disabled={creatingSession}
              onClick={showSessionLanding}
            >
              New session
            </button>
          ) : null}
          {state._tag === "Ready" ? (
            <button
              type="button"
              className="open-project-button"
              disabled={creatingSession}
              onClick={showProjects}
            >
              Projects
            </button>
          ) : null}
        </div>
      </header>

      {state._tag === "Ready" ? (
        state.screen === "landing" ? (
          <SessionLanding
            snapshot={state.snapshot}
            initialError={landingError}
            createSession={createSession}
            selectSession={selectSession}
          />
        ) : (
          <ProjectView
            snapshot={state.snapshot}
            promptRetry={promptRetry}
            submitPrompt={submitPrompt}
            interruptSession={interruptSession}
          />
        )
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
