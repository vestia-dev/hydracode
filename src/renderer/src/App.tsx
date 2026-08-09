import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react"
import { WorkspaceView } from "./components/WorkspaceView"
import { useWorkspaceController } from "./hooks/useWorkspaceController"

export function App() {
  const { state, openWorkspace, submitPrompt, interruptSession } = useWorkspaceController()
  const directory =
    state._tag === "Ready"
      ? state.snapshot.directory
      : state._tag === "Loading"
        ? state.directory
        : null

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <span className="product-name">HydraCode</span>
          <span className="workspace-path">{directory ?? "No workspace open"}</span>
        </div>
        <div className="header-actions">
          <span className="connection-state">
            {state._tag === "Ready"
              ? "Connected"
              : state._tag === "Loading"
                ? "Connecting"
                : "Not connected"}
          </span>
          <button type="button" className="open-workspace-button" onClick={openWorkspace}>
            Open workspace
          </button>
        </div>
      </header>

      {state._tag === "Ready" ? (
        <WorkspaceView
          snapshot={state.snapshot}
          submitPrompt={submitPrompt}
          interruptSession={interruptSession}
        />
      ) : (
        <section className="session-pane" aria-label="Workspace status">
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
            <h1>
              {state._tag === "Loading"
                ? "Connecting to OpenCode"
                : state._tag === "Error"
                  ? "Could not open workspace"
                  : "Open a workspace"}
            </h1>
            <p>
              {state._tag === "Error"
                ? state.message
                : state._tag === "Loading"
                  ? "Loading sessions and their agent history…"
                  : "Connect HydraCode to an OpenCode workspace to see its sessions."}
            </p>
            {state._tag === "Idle" || state._tag === "Error" ? (
              <button type="button" className="primary-button" onClick={openWorkspace}>
                Choose folder
              </button>
            ) : null}
          </div>
        </section>
      )}
    </main>
  )
}
