import { Schema } from "effect"
export { DesktopChannels } from "./desktopChannels"
import {
  SetBundledThemeCommand,
  Theme,
  type SetBundledThemeCommand as SetBundledThemeCommandType,
} from "./theme"
import { UpdateState } from "./update"
import { OpenCodeDiagnostics } from "./openCode"
import type { PaneDirection, PaneSplitCommand } from "./pane"
import type {
  ApplicationStateResult,
  ProjectSelectionState,
  ProjectUIState,
  ProjectUIStateResult,
} from "./applicationState"
import {
  ProjectCatalogEntry,
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  OpenProjectResult,
  ListProjectSessionsCommand,
  ListProjectSessionsResult,
  ActiveSessionsResult,
  SubmitPromptCommand,
  SessionInboxCommand,
  ReplyQuestionCommand,
  QuestionCommand,
  ProjectCommandResult,
  SessionCommand,
  SessionSnapshotResult,
  SessionMessageCommand,
  SessionMessageResult,
} from "./project"

export const DesktopFailure = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  message: Schema.String,
})
export type DesktopFailure = typeof DesktopFailure.Type

export const ProjectSelectionResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    project: Schema.Union([ProjectCatalogEntry, Schema.Null]),
  }),
  DesktopFailure,
])
export type ProjectSelectionResult = typeof ProjectSelectionResult.Type

export const ThemeResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    theme: Theme,
  }),
  DesktopFailure,
])
export type ThemeResult = typeof ThemeResult.Type

export const OpenCodeDiagnosticsResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    diagnostics: OpenCodeDiagnostics,
  }),
  DesktopFailure,
])
export type OpenCodeDiagnosticsResult = typeof OpenCodeDiagnosticsResult.Type

export {
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  OpenProjectResult,
  ListProjectSessionsCommand,
  ListProjectSessionsResult,
  ActiveSessionsResult,
  SubmitPromptCommand,
  SessionInboxCommand,
  ReplyQuestionCommand,
  QuestionCommand,
  ProjectCommandResult,
  SessionCommand,
  SessionSnapshotResult,
  SessionMessageCommand,
  SessionMessageResult,
  UpdateState,
  SetBundledThemeCommand,
}
export type {
  CreateSessionCommand as CreateSessionCommandType,
  OpenProjectCommand as OpenProjectCommandType,
  ListProjectSessionsCommand as ListProjectSessionsCommandType,
  SubmitPromptCommand as SubmitPromptCommandType,
  SessionInboxCommand as SessionInboxCommandType,
  ReplyQuestionCommand as ReplyQuestionCommandType,
  QuestionCommand as QuestionCommandType,
  SessionCommand as SessionCommandType,
  SessionMessageCommand as SessionMessageCommandType,
  SetBundledThemeCommand as SetBundledThemeCommandType,
}

export interface HydraCodeDesktopApi {
  readonly platform: NodeJS.Platform
  readonly loadTheme: () => Promise<ThemeResult>
  readonly setBundledTheme: (command: SetBundledThemeCommandType) => Promise<ThemeResult>
  readonly selectProject: () => Promise<ProjectSelectionResult>
  readonly listProjects: () => Promise<ListProjectsResult>
  readonly loadApplicationState: () => Promise<ApplicationStateResult>
  readonly saveProjectSelection: (state: ProjectSelectionState) => Promise<ApplicationStateResult>
  readonly saveProjectUIState: (state: ProjectUIState) => Promise<ProjectUIStateResult>
  readonly openProject: (command: OpenProjectCommand) => Promise<OpenProjectResult>
  readonly listProjectSessions: (
    command: ListProjectSessionsCommand,
  ) => Promise<ListProjectSessionsResult>
  readonly listActiveSessions: () => Promise<ActiveSessionsResult>
  readonly loadSessionSnapshot: (command: SessionCommand) => Promise<SessionSnapshotResult>
  readonly getSessionMessage: (command: SessionMessageCommand) => Promise<SessionMessageResult>
  readonly createSession: (command: CreateSessionCommand) => Promise<CreateSessionResult>
  readonly submitPrompt: (command: SubmitPromptCommand) => Promise<ProjectCommandResult>
  readonly updateSessionInbox: (command: SessionInboxCommand) => Promise<ProjectCommandResult>
  readonly replyQuestion: (command: ReplyQuestionCommand) => Promise<ProjectCommandResult>
  readonly rejectQuestion: (command: QuestionCommand) => Promise<ProjectCommandResult>
  readonly backgroundSession: (command: SessionCommand) => Promise<ProjectCommandResult>
  readonly interrupt: (command: SessionCommand) => Promise<ProjectCommandResult>
  readonly getOpenCodeDiagnostics: () => Promise<OpenCodeDiagnosticsResult>
  readonly installOpenCode: () => Promise<ProjectCommandResult>
  readonly checkForUpdates: () => Promise<UpdateState>
  readonly installUpdate: () => Promise<ProjectCommandResult>
  readonly restartForUpdate: () => Promise<ProjectCommandResult>
  readonly onUpdateState: (listener: (state: unknown) => void) => () => void
  readonly onOpenCodeEvent: (listener: (event: unknown) => void) => () => void
  readonly onPaneSplit: (listener: (command: PaneSplitCommand) => void) => () => void
  readonly onPaneFocus: (listener: (direction: PaneDirection) => void) => () => void
  readonly onPaneClose: (listener: () => void) => () => void
  readonly onPromptFocus: (listener: () => void) => () => void
  readonly onFollowLatest: (listener: () => void) => () => void
}
