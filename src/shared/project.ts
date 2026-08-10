import { Schema } from "effect"
import { AbsolutePath, Location, Project } from "@opencode-ai/client/effect"
import { SessionMessage } from "@opencode-ai/schema/session-message"

export const ProjectSessionExecution = Schema.Union([
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
export type ProjectSessionExecution = typeof ProjectSessionExecution.Type

export const ProjectSession = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  created: Schema.Number,
  title: Schema.String,
  active: Schema.Boolean,
  synchronized: Schema.Boolean,
  execution: ProjectSessionExecution,
  messages: Schema.Array(SessionMessage.Info),
})
export type ProjectSession = typeof ProjectSession.Type

export const ProjectSessionSummary = Schema.Struct({
  id: Schema.String,
  created: Schema.Number,
  title: Schema.String,
  active: Schema.Boolean,
})
export type ProjectSessionSummary = typeof ProjectSessionSummary.Type

export const ProjectDetails = Schema.Struct({
  id: Project.ID,
  canonical: AbsolutePath,
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
})
export type ProjectDetails = typeof ProjectDetails.Type

export const ProjectCatalogItem = Schema.Struct({
  project: ProjectDetails,
  location: Location.Ref,
  updated: Schema.Number,
})
export type ProjectCatalogItem = typeof ProjectCatalogItem.Type

export const ListProjectsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), projects: Schema.Array(ProjectCatalogItem) }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ListProjectsResult = typeof ListProjectsResult.Type

export const ProjectSnapshot = Schema.Struct({
  project: ProjectDetails,
  location: Location.Ref,
  sessions: Schema.Array(ProjectSession),
  recentSessions: Schema.Array(ProjectSessionSummary),
})
export type ProjectSnapshot = typeof ProjectSnapshot.Type

export const ProjectUpdate = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Snapshot"), snapshot: ProjectSnapshot }),
  Schema.Struct({
    _tag: Schema.Literal("Session"),
    projectID: Project.ID,
    session: ProjectSession,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Removed"),
    projectID: Project.ID,
    sessionID: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal("Error"), message: Schema.String }),
])
export type ProjectUpdate = typeof ProjectUpdate.Type

export const ProjectUpdateEnvelope = Schema.Struct({
  subscriptionID: Schema.String,
  update: ProjectUpdate,
})
export type ProjectUpdateEnvelope = typeof ProjectUpdateEnvelope.Type

export const OpenProjectCommand = Schema.Struct({ location: Location.Ref })
export type OpenProjectCommand = typeof OpenProjectCommand.Type

export const ProjectSubscription = Schema.Struct({ subscriptionID: Schema.String })
export type ProjectSubscription = typeof ProjectSubscription.Type

export const OpenProjectResult = Schema.Union([
  ProjectSubscription,
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    message: Schema.String,
  }),
])
export type OpenProjectResult = typeof OpenProjectResult.Type

export const ProjectSessionCommand = Schema.Struct({
  subscriptionID: Schema.String,
  sessionID: Schema.String,
})
export type ProjectSessionCommand = typeof ProjectSessionCommand.Type

export const SubmitPromptCommand = Schema.Struct({
  subscriptionID: Schema.String,
  sessionID: Schema.String,
  text: Schema.String,
})
export type SubmitPromptCommand = typeof SubmitPromptCommand.Type

export const CreateSessionCommand = Schema.Struct({
  subscriptionID: Schema.String,
})
export type CreateSessionCommand = typeof CreateSessionCommand.Type

export const CreateSessionResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), session: ProjectSession }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type CreateSessionResult = typeof CreateSessionResult.Type

export const ProjectCommandResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success") }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ProjectCommandResult = typeof ProjectCommandResult.Type
