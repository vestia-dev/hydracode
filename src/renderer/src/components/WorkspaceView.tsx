import type { Effect } from "effect"
import type { SessionView, WorkspaceSnapshot } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { groupSessionFamilies } from "../projectors/workspaceSessions"
import { SessionPane } from "./SessionPane"

interface WorkspaceViewProps {
  readonly snapshot: WorkspaceSnapshot
  readonly submitPrompt: (
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
}

export function WorkspaceView({ snapshot, submitPrompt, interruptSession }: WorkspaceViewProps) {
  if (snapshot.sessions.length === 0) {
    return (
      <section className="session-pane">
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">
            H
          </span>
          <h1>No sessions yet</h1>
          <p>Start an OpenCode session in this workspace and it will appear here.</p>
        </div>
      </section>
    )
  }

  const families = groupSessionFamilies(snapshot.sessions)

  return (
    <div
      className="session-stack"
      style={{ gridTemplateRows: `repeat(${families.length}, minmax(320px, 1fr))` }}
    >
      {families.map((family) => (
        <SessionPane
          key={family.root.id}
          session={family.root}
          descendants={family.descendants}
          submitPrompt={submitPrompt}
          interruptSession={interruptSession}
        />
      ))}
    </div>
  )
}
