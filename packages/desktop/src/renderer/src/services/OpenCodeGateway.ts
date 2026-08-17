import type { Question, Session } from "@opencode-ai/client/effect"
import type { SemanticGraph } from "../domain/graph"
import type { OptimisticPrompt } from "../domain/optimisticPrompts"
import type { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import type { SessionExecutionState } from "../../../shared/domain/sessionLog"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import type { SessionMessage } from "@opencode-ai/schema/session-message"

export interface PendingPrompt {
  readonly id: SessionMessage.ID
  readonly text: string
  readonly delivery: SessionInbox.Delivery
}

export interface SessionView {
  readonly id: Session.ID
  readonly parentID?: Session.ID
  readonly location: Location.Ref
  readonly created: number
  readonly title: string
  readonly active: boolean
  readonly execution: SessionExecutionState
  readonly questions: ReadonlyArray<Question.Request>
  readonly pendingPrompts: ReadonlyArray<PendingPrompt>
  readonly provisional: boolean
  readonly authoritativeGraph: SemanticGraph
  readonly optimisticPrompts: ReadonlyArray<OptimisticPrompt>
  readonly graph: SemanticGraph
}

export interface SessionSummary {
  readonly id: Session.ID
  readonly created: number
  readonly title: string
  readonly active: boolean
}

export interface ProjectView {
  readonly project: {
    readonly id: Project.ID
    readonly canonical: AbsolutePath
    readonly name?: string | undefined
    readonly icon?: Project.Icon | undefined
  }
  readonly location: Location.Ref
  readonly recentSessions: ReadonlyArray<SessionSummary>
}
