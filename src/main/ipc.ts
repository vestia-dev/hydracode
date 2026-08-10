import { Effect, Schema } from "effect"
import { ipcMain } from "electron"
import { DesktopChannels } from "../shared/desktopChannels"
import { SetBundledThemeCommand } from "../shared/theme"
import {
  ThemeResult,
  UpdateState,
  ProjectSubscription,
  ProjectUpdateEnvelope,
  type ProjectCommandResult as ProjectCommandResultType,
} from "../shared/ipc"
import {
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  SubmitPromptCommand,
  ProjectSessionCommand,
} from "../shared/project"
import { MainRuntime } from "./runtime"
import { DesktopService } from "./services/DesktopService"
import { ThemeService } from "./services/ThemeService"
import { UpdateService } from "./services/UpdateService"
import { ProjectRegistry } from "./services/ProjectRegistry"

const updateSubscriptions = new Map<number, () => void>()

function failureMessage(cause: unknown) {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The HydraCode desktop runtime failed unexpectedly."
}
const result = (
  effect: Effect.Effect<void, unknown, ProjectRegistry>,
): Promise<ProjectCommandResultType> =>
  MainRuntime.runPromise(
    // ManagedRuntime supplies ProjectRegistry; its public type does not erase the service identifier here.
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
  ipcMain.handle(
    DesktopChannels.setBundledTheme,
    (_event, input: unknown): Promise<ThemeResult> => {
      const command = Schema.decodeUnknownSync(SetBundledThemeCommand)(input)
      return MainRuntime.runPromise(
        ThemeService.use((themes) =>
          themes.selectBundled(command.theme).pipe(
            Effect.match({
              onFailure: (error) => ({ _tag: "Failure" as const, message: error.message }),
              onSuccess: (theme) => ({ _tag: "Success" as const, theme }),
            }),
          ),
        ),
      ).catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) }))
    },
  )
  ipcMain.handle(DesktopChannels.selectProject, () =>
    MainRuntime.runPromise(
      DesktopService.use((desktop) =>
        desktop.selectProject.pipe(
          Effect.match({
            onFailure: (error) => ({ _tag: "Failure" as const, message: error.message }),
            onSuccess: (directory) => ({ _tag: "Success" as const, directory }),
          }),
        ),
      ),
    ).catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.listProjects, () =>
    MainRuntime.runPromise(ProjectRegistry.use((registry) => registry.list))
      .then((projects) =>
        Schema.encodeSync(ListProjectsResult)({ _tag: "Success" as const, projects }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.openProject, (event, input: unknown) => {
    const command = Schema.decodeUnknownSync(OpenProjectCommand)(input)
    return MainRuntime.runPromise(
      ProjectRegistry.use((registry) =>
        registry.open(command.location, (subscriptionID, update) => {
          const envelope = Schema.encodeSync(ProjectUpdateEnvelope)({ subscriptionID, update })
          event.sender.send(DesktopChannels.projectUpdate, envelope)
        }),
      ),
    )
      .then((subscriptionID) => {
        return { subscriptionID }
      })
      .then((value) => value)
      .catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.closeProject, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ProjectSubscription)(input)
    return result(ProjectRegistry.use((registry) => registry.close(command.subscriptionID)))
  })
  ipcMain.handle(DesktopChannels.selectSession, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ProjectSessionCommand)(input)
    return result(
      ProjectRegistry.use((registry) =>
        registry.selectSession(command.subscriptionID, command.sessionID),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.createSession, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(CreateSessionCommand)(input)
    return MainRuntime.runPromise(
      ProjectRegistry.use((registry) => registry.createSession(command.subscriptionID)),
    )
      .then((value) => Schema.encodeSync(CreateSessionResult)(value))
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.submitPrompt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SubmitPromptCommand)(input)
    return result(
      ProjectRegistry.use((registry) =>
        registry.submitPrompt(command.subscriptionID, command.sessionID, command.text),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.interrupt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ProjectSessionCommand)(input)
    return result(
      ProjectRegistry.use((registry) =>
        registry.interrupt(command.subscriptionID, command.sessionID),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.updateSubscribe, (event) =>
    MainRuntime.runPromise(
      UpdateService.use((updates) =>
        updates.subscribe((state) => {
          if (event.sender.isDestroyed()) return
          event.sender.send(DesktopChannels.updateState, Schema.encodeSync(UpdateState)(state))
        }),
      ),
    ).then((remove) => {
      const id = event.sender.id
      updateSubscriptions.get(id)?.()
      updateSubscriptions.set(id, remove)
      event.sender.once("destroyed", () => {
        updateSubscriptions.get(id)?.()
        updateSubscriptions.delete(id)
      })
    }),
  )
  ipcMain.handle(DesktopChannels.updateCheck, () =>
    MainRuntime.runPromise(UpdateService.use((updates) => updates.check)),
  )
  ipcMain.handle(DesktopChannels.updateInstall, () =>
    MainRuntime.runPromise(
      UpdateService.use((updates) =>
        updates.install.pipe(
          Effect.map(() => ({ _tag: "Success" as const })),
          Effect.catch((cause) =>
            Effect.succeed({ _tag: "Failure" as const, message: failureMessage(cause) }),
          ),
        ),
      ),
    ),
  )
}
