import { Schema } from "effect"
export { DesktopChannels } from "./desktopChannels"
import { Theme } from "./theme"
import {
  OpenWorkspaceCommand,
  OpenWorkspaceResult,
  SubmitPromptCommand,
  WorkspaceCommandResult,
  WorkspaceSessionCommand,
  WorkspaceSubscription,
  WorkspaceUpdate,
  WorkspaceUpdateEnvelope,
} from "./workspace"

export const DesktopFailure = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  message: Schema.String,
})
export type DesktopFailure = typeof DesktopFailure.Type

export const WorkspaceSelectionResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    directory: Schema.Union([Schema.String, Schema.Null]),
  }),
  DesktopFailure,
])
export type WorkspaceSelectionResult = typeof WorkspaceSelectionResult.Type

export const ThemeResult = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    theme: Theme,
  }),
  DesktopFailure,
])
export type ThemeResult = typeof ThemeResult.Type

export {
  OpenWorkspaceCommand,
  OpenWorkspaceResult,
  SubmitPromptCommand,
  WorkspaceCommandResult,
  WorkspaceSessionCommand,
  WorkspaceSubscription,
  WorkspaceUpdate,
  WorkspaceUpdateEnvelope,
}
export type {
  OpenWorkspaceCommand as OpenWorkspaceCommandType,
  SubmitPromptCommand as SubmitPromptCommandType,
  WorkspaceSessionCommand as WorkspaceSessionCommandType,
}

export interface HydraCodeDesktopApi {
  readonly platform: NodeJS.Platform
  readonly loadTheme: () => Promise<ThemeResult>
  readonly selectWorkspace: () => Promise<WorkspaceSelectionResult>
  readonly openWorkspace: (command: OpenWorkspaceCommand) => Promise<OpenWorkspaceResult>
  readonly closeWorkspace: (command: WorkspaceSubscription) => Promise<WorkspaceCommandResult>
  readonly submitPrompt: (command: SubmitPromptCommand) => Promise<WorkspaceCommandResult>
  readonly interrupt: (command: WorkspaceSessionCommand) => Promise<WorkspaceCommandResult>
  readonly onWorkspaceUpdate: (listener: (update: unknown) => void) => () => void
}
