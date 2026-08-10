import { Schema } from "effect"
export { DesktopChannels } from "./desktopChannels"
import { Theme } from "./theme"
import { UpdateState } from "./update"
import {
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  OpenProjectResult,
  SubmitPromptCommand,
  ProjectCommandResult,
  ProjectSessionCommand,
  ProjectSubscription,
  ProjectUpdate,
  ProjectUpdateEnvelope,
} from "./project"

export const DesktopFailure = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  message: Schema.String,
})
export type DesktopFailure = typeof DesktopFailure.Type

export const ProjectSelectionResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    directory: Schema.Union([Schema.String, Schema.Null]),
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

export {
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  OpenProjectResult,
  SubmitPromptCommand,
  ProjectCommandResult,
  ProjectSessionCommand,
  ProjectSubscription,
  ProjectUpdate,
  ProjectUpdateEnvelope,
  UpdateState,
}
export type {
  CreateSessionCommand as CreateSessionCommandType,
  OpenProjectCommand as OpenProjectCommandType,
  SubmitPromptCommand as SubmitPromptCommandType,
  ProjectSessionCommand as ProjectSessionCommandType,
}

export interface HydraCodeDesktopApi {
  readonly platform: NodeJS.Platform
  readonly loadTheme: () => Promise<ThemeResult>
  readonly selectProject: () => Promise<ProjectSelectionResult>
  readonly listProjects: () => Promise<ListProjectsResult>
  readonly openProject: (command: OpenProjectCommand) => Promise<OpenProjectResult>
  readonly closeProject: (command: ProjectSubscription) => Promise<ProjectCommandResult>
  readonly selectSession: (command: ProjectSessionCommand) => Promise<ProjectCommandResult>
  readonly createSession: (command: CreateSessionCommand) => Promise<CreateSessionResult>
  readonly submitPrompt: (command: SubmitPromptCommand) => Promise<ProjectCommandResult>
  readonly interrupt: (command: ProjectSessionCommand) => Promise<ProjectCommandResult>
  readonly checkForUpdates: () => Promise<UpdateState>
  readonly installUpdate: () => Promise<ProjectCommandResult>
  readonly onUpdateState: (listener: (state: unknown) => void) => () => void
  readonly onProjectUpdate: (listener: (update: unknown) => void) => () => void
}
