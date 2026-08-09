import { Schema } from "effect"
import { SessionMessage } from "@opencode-ai/schema/session-message"

export const WorkspaceSessionExecution = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Idle") }),
  Schema.Struct({ _tag: Schema.Literal("Running") }),
  Schema.Struct({
    _tag: Schema.Literal("Retrying"),
    attempt: Schema.Number,
    at: Schema.Number,
    message: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal("Failed"), message: Schema.String }),
])
export type WorkspaceSessionExecution = typeof WorkspaceSessionExecution.Type

export const WorkspaceSession = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  created: Schema.Number,
  title: Schema.String,
  active: Schema.Boolean,
  synchronized: Schema.Boolean,
  execution: WorkspaceSessionExecution,
  messages: Schema.Array(SessionMessage.Info),
})
export type WorkspaceSession = typeof WorkspaceSession.Type

export const WorkspaceSnapshot = Schema.Struct({
  directory: Schema.String,
  sessions: Schema.Array(WorkspaceSession),
})
export type WorkspaceSnapshot = typeof WorkspaceSnapshot.Type

export const WorkspaceUpdate = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Snapshot"), snapshot: WorkspaceSnapshot }),
  Schema.Struct({
    _tag: Schema.Literal("Session"),
    directory: Schema.String,
    session: WorkspaceSession,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Removed"),
    directory: Schema.String,
    sessionID: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal("Error"), message: Schema.String }),
])
export type WorkspaceUpdate = typeof WorkspaceUpdate.Type

export const WorkspaceUpdateEnvelope = Schema.Struct({
  subscriptionID: Schema.String,
  update: WorkspaceUpdate,
})
export type WorkspaceUpdateEnvelope = typeof WorkspaceUpdateEnvelope.Type

export const OpenWorkspaceCommand = Schema.Struct({ directory: Schema.String })
export type OpenWorkspaceCommand = typeof OpenWorkspaceCommand.Type

export const WorkspaceSubscription = Schema.Struct({ subscriptionID: Schema.String })
export type WorkspaceSubscription = typeof WorkspaceSubscription.Type

export const OpenWorkspaceResult = Schema.Union([
  WorkspaceSubscription,
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    message: Schema.String,
  }),
])
export type OpenWorkspaceResult = typeof OpenWorkspaceResult.Type

export const WorkspaceSessionCommand = Schema.Struct({
  subscriptionID: Schema.String,
  sessionID: Schema.String,
})
export type WorkspaceSessionCommand = typeof WorkspaceSessionCommand.Type

export const SubmitPromptCommand = Schema.Struct({
  subscriptionID: Schema.String,
  sessionID: Schema.String,
  text: Schema.String,
})
export type SubmitPromptCommand = typeof SubmitPromptCommand.Type

export const WorkspaceCommandResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success") }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type WorkspaceCommandResult = typeof WorkspaceCommandResult.Type
