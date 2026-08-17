import type { Question, Session } from "@opencode-ai/client/effect"
import type { SemanticGraph } from "../domain/graph"
import type { OptimisticPrompt } from "../domain/optimisticPrompts"
import type { ProjectPendingPrompt, ProjectSessionExecution } from "../../../shared/project"
import type { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"

export interface SessionView {
  readonly id: Session.ID
  readonly parentID?: Session.ID
  readonly location?: Location.Ref
  readonly created: number
  readonly title: string
  readonly active: boolean
  readonly execution: ProjectSessionExecution
  readonly questions: ReadonlyArray<Question.Request>
  readonly pendingPrompts: ReadonlyArray<ProjectPendingPrompt>
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
  readonly sessions: ReadonlyArray<SessionView>
  readonly recentSessions: ReadonlyArray<SessionSummary>
}
