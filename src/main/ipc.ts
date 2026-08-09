import { Effect, Schema } from "effect"
import { ipcMain } from "electron"
import { DesktopChannels } from "../shared/desktopChannels"
import {
  ThemeResult,
  WorkspaceSubscription,
  WorkspaceUpdateEnvelope,
  type WorkspaceCommandResult as WorkspaceCommandResultType,
} from "../shared/ipc"
import {
  OpenWorkspaceCommand,
  SubmitPromptCommand,
  WorkspaceSessionCommand,
} from "../shared/workspace"
import { MainRuntime } from "./runtime"
import { DesktopService } from "./services/DesktopService"
import { ThemeService } from "./services/ThemeService"
import { WorkspaceRegistry } from "./services/WorkspaceRegistry"

function failureMessage(cause: unknown) {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The HydraCode desktop runtime failed unexpectedly."
}
const result = (
  effect: Effect.Effect<void, unknown, WorkspaceRegistry>,
): Promise<WorkspaceCommandResultType> =>
  MainRuntime.runPromise(
    // ManagedRuntime supplies WorkspaceRegistry; its public type does not erase the service identifier here.
    // oxlint-disable-next-line no-unsafe-type-assertion
    (effect as Effect.Effect<void, unknown>).pipe(
      Effect.map(() => ({ _tag: "Success" as const })),
      Effect.catch((cause) =>
        Effect.succeed({ _tag: "Failure" as const, message: failureMessage(cause) }),
      ),
    ),
  )

export function registerDesktopIpc() {
  ipcMain.handle(DesktopChannels.loadTheme, (): Promise<ThemeResult> =>
    MainRuntime.runPromise(
      ThemeService.use((themes) =>
        themes.load.pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Failure" as const, message: error.message }),
            onSuccess: (theme) => ({ _tag: "Success" as const, theme }),
          }),
        ),
      ),
    ).catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.selectWorkspace, () =>
    MainRuntime.runPromise(
      DesktopService.use((desktop) =>
        desktop.selectWorkspace.pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Failure" as const, message: error.message }),
            onSuccess: (directory) => ({ _tag: "Success" as const, directory }),
          }),
        ),
      ),
    ).catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.openWorkspace, (event, input: unknown) => {
    const command = Schema.decodeUnknownSync(OpenWorkspaceCommand)(input)
    return MainRuntime.runPromise(
      WorkspaceRegistry.use((registry) =>
        registry.open(command.directory, (subscriptionID, update) => {
          const envelope = Schema.encodeSync(WorkspaceUpdateEnvelope)({ subscriptionID, update })
          event.sender.send(DesktopChannels.workspaceUpdate, envelope)
        }),
      ),
    )
      .then((subscriptionID) => {
        return { subscriptionID }
      })
      .then((value) => value)
      .catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.closeWorkspace, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(WorkspaceSubscription)(input)
    return result(WorkspaceRegistry.use((registry) => registry.close(command.subscriptionID)))
  })
  ipcMain.handle(DesktopChannels.submitPrompt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SubmitPromptCommand)(input)
    return result(
      WorkspaceRegistry.use((registry) =>
        registry.submitPrompt(command.subscriptionID, command.sessionID, command.text),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.interrupt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(WorkspaceSessionCommand)(input)
    return result(
      WorkspaceRegistry.use((registry) =>
        registry.interrupt(command.subscriptionID, command.sessionID),
      ),
    )
  })
}
