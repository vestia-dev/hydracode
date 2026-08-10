import type { Effect } from "effect"
import type { ProjectSnapshot, SessionView } from "../services/OpenCodeGateway"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { groupSessionFamilies } from "../projectors/projectSessions"
import { SessionPane } from "./SessionPane"

interface ProjectViewProps {
  readonly snapshot: ProjectSnapshot
  readonly submitPrompt: (
    sessionID: SessionView["id"],
    text: string,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly interruptSession: (
    sessionID: SessionView["id"],
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly promptRetry: {
    readonly sessionID: SessionView["id"]
    readonly text: string
    readonly message: string
  } | null
}

export function ProjectView({
  snapshot,
  submitPrompt,
  interruptSession,
  promptRetry,
}: ProjectViewProps) {
  if (snapshot.sessions.length === 0) {
    return (
      <section className="session-pane">
        <div className="empty-state">
          <span className="empty-mark" aria-hidden="true">
            H
          </span>
          <h1>No sessions yet</h1>
          <p>Start an OpenCode session in this project and it will appear here.</p>
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
          retryPrompt={promptRetry?.sessionID === family.root.id ? promptRetry : undefined}
        />
      ))}
    </div>
  )
}
