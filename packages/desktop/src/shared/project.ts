import { Schema } from "effect"
import {
  AbsolutePath,
  Event,
  Form,
  Location,
  Project,
  Question,
  Session,
} from "@opencode-ai/client/effect"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionInbox } from "@opencode-ai/schema/session-inbox"

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

export const OpenProjectCommand = Schema.Struct({ location: Schema.optional(Location.Ref) })
export type OpenProjectCommand = typeof OpenProjectCommand.Type

export const OpenProjectResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), projectID: Project.ID }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type OpenProjectResult = typeof OpenProjectResult.Type

export const ListProjectSessionsCommand = Schema.Struct({
  projectID: Project.ID,
  location: Location.Ref,
})
export type ListProjectSessionsCommand = typeof ListProjectSessionsCommand.Type

export const ListProjectSessionsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), sessions: Schema.Array(Session.Info) }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ListProjectSessionsResult = typeof ListProjectSessionsResult.Type

export const ActiveSessionsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), sessionIDs: Schema.Array(Session.ID) }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ActiveSessionsResult = typeof ActiveSessionsResult.Type

export const SessionCommand = Schema.Struct({ sessionID: Session.ID })
export type SessionCommand = typeof SessionCommand.Type

export const SessionSnapshot = Schema.Struct({
  info: Session.Info,
  messages: Schema.Array(SessionMessage.Info),
  durableSeq: Schema.optional(Event.Seq),
  questions: Schema.Array(Question.Request),
  forms: Schema.Array(Form.Info),
  inbox: Schema.Array(SessionInbox.Info),
})
export type SessionSnapshot = typeof SessionSnapshot.Type

export const SessionSnapshotResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), snapshot: SessionSnapshot }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type SessionSnapshotResult = typeof SessionSnapshotResult.Type

export const SessionMessageCommand = Schema.Struct({
  sessionID: Session.ID,
  messageID: SessionMessage.ID,
})
export type SessionMessageCommand = typeof SessionMessageCommand.Type

export const SessionMessageResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), message: SessionMessage.Info }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type SessionMessageResult = typeof SessionMessageResult.Type

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
  Schema.Struct({ _tag: Schema.Literal("Success"), session: Session.Info }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type CreateSessionResult = typeof CreateSessionResult.Type

export const ProjectCommandResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success") }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type ProjectCommandResult = typeof ProjectCommandResult.Type
