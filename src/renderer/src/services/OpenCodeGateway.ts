import type { Session } from "@opencode-ai/client/effect"
import { Schema } from "effect"
import type { SemanticGraph } from "../domain/graph"
import type { WorkspaceSessionExecution } from "../../../shared/workspace"

export interface SessionView {
  readonly id: Session.ID
  readonly parentID?: Session.ID
  readonly created: number
  readonly title: string
  readonly active: boolean
  readonly synchronized: boolean
  readonly execution: WorkspaceSessionExecution
  readonly graph: SemanticGraph
}

export interface WorkspaceSnapshot {
  readonly directory: string
  readonly sessions: ReadonlyArray<SessionView>
}

export class OpenCodeGatewayError extends Schema.TaggedErrorClass<OpenCodeGatewayError>()(
  "OpenCodeGatewayError",
  { message: Schema.String, cause: Schema.Defect() },
) {}
export interface OpenCodeGateway {
  readonly submitPrompt: never
}
