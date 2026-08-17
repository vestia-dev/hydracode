import { Schema } from "effect"
import { AbsolutePath, Location, Project, Question, Session } from "@opencode-ai/client/effect"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"

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

export const ProjectPendingPrompt = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.String,
  delivery: SessionInbox.Delivery,
})
export type ProjectPendingPrompt = typeof ProjectPendingPrompt.Type

export const ProjectSession = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  location: Schema.optional(Location.Ref),
  created: Schema.Number,
  title: Schema.String,
  active: Schema.Boolean,
  execution: ProjectSessionExecution,
  messages: Schema.Array(SessionMessage.Info),
  pendingPrompts: Schema.Array(ProjectPendingPrompt),
  questions: Schema.Array(Question.Request),
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

export const ProjectLocation = Schema.Struct({
  ref: Location.Ref,
  kind: Schema.Union([
    Schema.Literal("canonical"),
    Schema.Literal("worktree"),
    Schema.Literal("sandbox"),
    Schema.Literal("selected"),
  ]),
})
export type ProjectLocation = typeof ProjectLocation.Type

export const ProjectCatalogEntry = Schema.Struct({
  project: ProjectDetails,
  locations: Schema.Array(ProjectLocation),
  updated: Schema.Number,
})
export type ProjectCatalogEntry = typeof ProjectCatalogEntry.Type

export const ListProjectsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), projects: Schema.Array(ProjectCatalogEntry) }),
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
  location: Location.Ref,
  update: ProjectUpdate,
})
export type ProjectUpdateEnvelope = typeof ProjectUpdateEnvelope.Type

export const OpenProjectCommand = Schema.Struct({ location: Schema.optional(Location.Ref) })
export type OpenProjectCommand = typeof OpenProjectCommand.Type

export const CloseProjectCommand = Schema.Struct({ location: Location.Ref })
export type CloseProjectCommand = typeof CloseProjectCommand.Type

export const ProjectSessionCommand = Schema.Struct({
  location: Location.Ref,
  sessionID: Schema.String,
})
export type ProjectSessionCommand = typeof ProjectSessionCommand.Type

export const SessionCommand = Schema.Struct({ sessionID: Session.ID })
export type SessionCommand = typeof SessionCommand.Type

export const SubmitPromptCommand = Schema.Struct({
  sessionID: Session.ID,
  text: Schema.String,
  delivery: Schema.optional(SessionInbox.Delivery),
})
export type SubmitPromptCommand = typeof SubmitPromptCommand.Type

export const SessionInboxCommand = Schema.Struct({
  sessionID: Session.ID,
  inboxID: SessionMessage.ID,
  action: Schema.Literals(["cancel", "queue", "steer"]),
})
export type SessionInboxCommand = typeof SessionInboxCommand.Type

export const QuestionCommand = Schema.Struct({
  sessionID: Session.ID,
  requestID: Question.ID,
})
export type QuestionCommand = typeof QuestionCommand.Type

export const ReplyQuestionCommand = Schema.Struct({
  ...QuestionCommand.fields,
  answers: Schema.Array(Question.Answer),
})
export type ReplyQuestionCommand = typeof ReplyQuestionCommand.Type

export const CreateSessionCommand = Schema.Struct({
  location: Location.Ref,
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

export const SessionLoadTiming = Schema.Struct({
  sessionID: Schema.String,
  offset: Schema.Number,
  duration: Schema.Number,
  watermarkDuration: Schema.Number,
  contextDuration: Schema.Number,
  questionsDuration: Schema.Number,
  formsDuration: Schema.Number,
  stateBuildDuration: Schema.Number,
  messages: Schema.Number,
  questions: Schema.Number,
  forms: Schema.Number,
})
export type SessionLoadTiming = typeof SessionLoadTiming.Type

export const SessionSelectionTiming = Schema.Struct({
  duration: Schema.Number,
  sessionGetDuration: Schema.Number,
  familySize: Schema.Number,
  snapshotDuration: Schema.Number,
  sessions: Schema.Array(SessionLoadTiming),
})
export type SessionSelectionTiming = typeof SessionSelectionTiming.Type

export const SelectSessionResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), timing: SessionSelectionTiming }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type SelectSessionResult = typeof SelectSessionResult.Type
