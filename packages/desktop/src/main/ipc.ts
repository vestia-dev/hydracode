import { Effect, Schema } from "effect"
import { ipcMain } from "electron"
import { Location, Project, Session } from "@opencode-ai/client/effect"
import { DesktopChannels } from "../shared/desktopChannels"
import { SetBundledThemeCommand } from "../shared/theme"
import {
  ThemeResult,
  OpenCodeDiagnosticsResult,
  UpdateState,
  ProjectUpdateEnvelope,
  type ProjectCommandResult as ProjectCommandResultType,
} from "../shared/ipc"
import {
  CreateSessionCommand,
  CreateSessionResult,
  ListProjectsResult,
  OpenProjectCommand,
  OpenProjectResult,
  ListProjectSessionsCommand,
  ListProjectSessionsResult,
  ActiveSessionsResult,
  QuestionCommand,
  ReplyQuestionCommand,
  SubmitPromptCommand,
  SessionInboxCommand,
  SessionCommand,
  type ProjectLocation,
} from "../shared/project"
import { MainRuntime } from "./runtime"
import { DesktopService } from "./services/DesktopService"
import { ThemeService } from "./services/ThemeService"
import { UpdateService } from "./services/UpdateService"
import { ProjectRegistry } from "./services/ProjectRegistry"
import { OpenCodeService, OpenCodeServiceError } from "./services/OpenCodeService"
import {
  ApplicationStateResult,
  ProjectSelectionState,
  ProjectUIState,
  ProjectUIStateResult,
} from "../shared/applicationState"
import { ApplicationStateService } from "./services/ApplicationStateService"
import { questionFormAnswer, questionFormID } from "../shared/domain/sessionLog"
import { availableProjects, projectName } from "../shared/domain/projectCatalog"

const updateSubscriptions = new Map<number, () => void>()

function failureMessage(cause: unknown) {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "The HydraCode desktop runtime failed unexpectedly."
}
const result = <R>(effect: Effect.Effect<void, unknown, R>): Promise<ProjectCommandResultType> =>
  MainRuntime.runPromise(
    // ManagedRuntime supplies application services; its public type does not erase service identifiers here.
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
        const directory = yield* desktop.selectProject
        if (directory === null) return { _tag: "Success" as const, project: null }
        const location = Schema.decodeUnknownSync(Location.Ref)({ directory })
        const service = yield* OpenCodeService
        const client = yield* service.client
        const current = yield* client.project.current({ location: { directory } })
        const projects = yield* client.project.list()
        const info = projects.find((project) => project.id === current.id)
        const project = {
          project: {
            id: current.id,
            canonical: info?.canonical ?? current.canonical,
            ...projectName(info?.name),
            ...(info?.icon === undefined ? {} : { icon: info.icon }),
          },
          locations: [{ ref: location, kind: "selected" as const }],
          updated: info?.time.updated ?? Date.now(),
        }
        return { _tag: "Success" as const, project }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({ _tag: "Failure" as const, message: failureMessage(error) }),
        ),
      ),
    ).catch((cause) => ({ _tag: "Failure", message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.listProjects, () =>
    MainRuntime.runPromise(
      OpenCodeService.use((service) =>
        Effect.gen(function* () {
          const client = yield* service.client
          const projects = yield* client.project.list()
          const locations = new Map<Project.ID, ReadonlyArray<ProjectLocation>>()
          yield* Effect.forEach(
            projects,
            (project) =>
              client.worktree.list({ projectID: project.id }).pipe(
                Effect.map((worktrees) =>
                  locations.set(
                    project.id,
                    worktrees.map((worktree) => ({
                      ref: Location.Ref.make({ directory: worktree.directory }),
                      kind: "worktree" as const,
                    })),
                  ),
                ),
              ),
            { concurrency: "unbounded" },
          )
          return availableProjects(projects, locations)
        }),
      ),
    )
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
        registry.open(command.location, (location, update) => {
          const envelope = Schema.encodeSync(ProjectUpdateEnvelope)({ location, update })
          event.sender.send(DesktopChannels.projectUpdate, envelope)
        }),
      ),
    )
      .then((projectID) => Schema.encodeSync(OpenProjectResult)({ _tag: "Success", projectID }))
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.listProjectSessions, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ListProjectSessionsCommand)(input)
    return MainRuntime.runPromise(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) =>
            client.session.list({
              project: command.projectID,
              directory: command.location.directory,
              ...(command.location.workspaceID === undefined
                ? {}
                : { workspace: command.location.workspaceID }),
              limit: 50,
              order: "desc",
            }),
          ),
        ),
      ),
    )
      .then((page) =>
        Schema.encodeSync(ListProjectSessionsResult)({ _tag: "Success", sessions: page.data }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.listActiveSessions, () =>
    MainRuntime.runPromise(
      OpenCodeService.use((service) =>
        service.client.pipe(Effect.flatMap((client) => client.session.active())),
      ),
    )
      .then((active) =>
        Schema.encodeSync(ActiveSessionsResult)({
          _tag: "Success",
          sessionIDs: Object.keys(active).map((id) => Schema.decodeUnknownSync(Session.ID)(id)),
        }),
      )
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) })),
  )
  ipcMain.handle(DesktopChannels.selectSession, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SessionCommand)(input)
    return MainRuntime.runPromise(
      ProjectRegistry.use((registry) => registry.selectSession(command.sessionID)),
    )
      .then((timing) => ({ _tag: "Success" as const, timing }))
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.createSession, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(CreateSessionCommand)(input)
    return MainRuntime.runPromise(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) => client.session.create({ location: command.location })),
        ),
      ),
    )
      .then((session) => Schema.encodeSync(CreateSessionResult)({ _tag: "Success", session }))
      .catch((cause) => ({ _tag: "Failure" as const, message: failureMessage(cause) }))
  })
  ipcMain.handle(DesktopChannels.submitPrompt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SubmitPromptCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        command.text.trim() === ""
          ? Effect.fail(
              new OpenCodeServiceError({
                message: "Enter a prompt before sending.",
                cause: command.text,
              }),
            )
          : service.client.pipe(
              Effect.flatMap((client) =>
                client.session.prompt({
                  sessionID: command.sessionID,
                  text: command.text.trim(),
                  delivery: command.delivery,
                }),
              ),
              Effect.asVoid,
            ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.updateSessionInbox, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SessionInboxCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) =>
            client.session.inbox[command.action]({
              sessionID: command.sessionID,
              inboxID: command.inboxID,
            }),
          ),
        ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.replyQuestion, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(ReplyQuestionCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) =>
            Effect.gen(function* () {
              const formID = questionFormID(command.requestID)
              if (formID === undefined) {
                yield* client.question.reply({
                  sessionID: command.sessionID,
                  requestID: command.requestID,
                  answers: command.answers,
                })
                return
              }
              const form = yield* client.form.get({ sessionID: command.sessionID, formID })
              yield* client.form.reply({
                sessionID: command.sessionID,
                formID,
                answer: questionFormAnswer(form, command.answers),
              })
            }),
          ),
          Effect.asVoid,
        ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.rejectQuestion, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(QuestionCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) =>
            Effect.gen(function* () {
              const formID = questionFormID(command.requestID)
              if (formID === undefined) {
                yield* client.question.reject({
                  sessionID: command.sessionID,
                  requestID: command.requestID,
                })
                return
              }
              yield* client.form.cancel({ sessionID: command.sessionID, formID })
            }),
          ),
          Effect.asVoid,
        ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.backgroundSession, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SessionCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) => client.session.background({ sessionID: command.sessionID })),
        ),
      ),
    )
  })
  ipcMain.handle(DesktopChannels.interrupt, (_event, input: unknown) => {
    const command = Schema.decodeUnknownSync(SessionCommand)(input)
    return result(
      OpenCodeService.use((service) =>
        service.client.pipe(
          Effect.flatMap((client) => client.session.interrupt({ sessionID: command.sessionID })),
        ),
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
