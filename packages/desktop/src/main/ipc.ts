import { Effect, Schema } from "effect"
import { ipcMain } from "electron"
import { Location } from "@opencode-ai/client/effect"
import { DesktopChannels } from "../shared/desktopChannels"
import { SetBundledThemeCommand } from "../shared/theme"
import {
  ThemeResult,
  OpenCodeDiagnosticsResult,
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
  QuestionCommand,
  ReplyQuestionCommand,
  SubmitPromptCommand,
  ProjectSessionCommand,
} from "../shared/project"
import { MainRuntime } from "./runtime"
import { DesktopService } from "./services/DesktopService"
import { ThemeService } from "./services/ThemeService"
import { UpdateService } from "./services/UpdateService"
import { ProjectRegistry } from "./services/ProjectRegistry"
import { OpenCodeService } from "./services/OpenCodeService"
import {
  ApplicationStateResult,
  ProjectSelectionState,
  ProjectUIState,
  ProjectUIStateResult,
} from "../shared/applicationState"
import { ApplicationStateService } from "./services/ApplicationStateService"

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
      Effect.gen(function* () {
        const desktop = yield* DesktopService
        const registry = yield* ProjectRegistry
        const directory = yield* desktop.selectProject
        if (directory === null) return { _tag: "Success" as const, project: null }
        const location = Schema.decodeUnknownSync(Location.Ref)({ directory })
        const project = yield* registry.resolve(location)
        return { _tag: "Success" as const, project }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({ _tag: "Failure" as const, message: failureMessage(error) }),
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
  ipcMain.handle(DesktopChannels.loadApplicationState, () =>
    MainRuntime.runPromise(ApplicationStateService.use((service) => service.load))
      .then((state) =>
        Schema.encodeSync(ApplicationStateResult)({ _tag: "Success" as const, state }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.saveProjectSelection, (_event, input: unknown) => {
    const state = Schema.decodeUnknownSync(ProjectSelectionState)(input)
    return MainRuntime.runPromise(
      ApplicationStateService.use((service) => service.saveSelection(state)),
    )
      .then((saved) =>
        Schema.encodeSync(ApplicationStateResult)({
          _tag: "Success" as const,
          state: saved,
        }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.saveProjectUIState, (_event, input: unknown) => {
    const state = Schema.decodeUnknownSync(ProjectUIState)(input)
    return MainRuntime.runPromise(
      ApplicationStateService.use((service) => service.saveProjectUIState(state)),
    )
      .then((saved) =>
        Schema.encodeSync(ProjectUIStateResult)({ _tag: "Success" as const, state: saved }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.openCodeDiagnostics, () =>
    MainRuntime.runPromise(OpenCodeService.use((service) => service.diagnostics))
      .then((diagnostics) =>
        Schema.encodeSync(OpenCodeDiagnosticsResult)({ _tag: "Success" as const, diagnostics }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.installOpenCode, () =>
    MainRuntime.runPromise(
      OpenCodeService.use((service) =>
        service.install.pipe(
          Effect.as({ _tag: "Success" as const }),
          Effect.catch((cause) =>
            Effect.succeed({ _tag: "Failure" as const, message: failureMessage(cause) }),
          ),
        ),
      ),
    ),
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
    return MainRuntime.runPromise(
      ProjectRegistry.use((registry) =>
        registry.selectSession(command.subscriptionID, command.sessionID),
      ),
    )
      .then((timing) => ({ _tag: "Success" as const, timing }))
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
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
  ipcMain.handle(DesktopChannels.replyQuestion, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ReplyQuestionCommand)(input)
    return result(
      ProjectRegistry.use((registry) =>
        registry.replyQuestion(
          command.subscriptionID,
          command.sessionID,
          command.requestID,
          command.answers,
        ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.rejectQuestion, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(QuestionCommand)(input)
    return result(
      ProjectRegistry.use((registry) =>
        registry.rejectQuestion(command.subscriptionID, command.sessionID, command.requestID),
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
  ipcMain.handle(DesktopChannels.updateRestart, () =>
    MainRuntime.runPromise(
      UpdateService.use((updates) =>
        updates.restart.pipe(
          Effect.map(() => ({ _tag: "Success" as const })),
          Effect.catch((cause) =>
            Effect.succeed({ _tag: "Failure" as const, message: failureMessage(cause) }),
          ),
        ),
      ),
    ),
  )
}
