import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  CreateSessionResult,
  ListProjectsResult,
  ProjectUpdateEnvelope,
  ProjectUpdate,
  ProjectCommandResult,
  OpenProjectResult,
  type OpenProjectCommand,
  type CreateSessionCommand,
  type SubmitPromptCommand,
  type ReplyQuestionCommand,
  type QuestionCommand,
  type ProjectSessionCommand,
  UpdateState,
  OpenCodeDiagnosticsResult,
} from "../../../shared/ipc"
import { ThemeResult, ProjectSelectionResult } from "../../../shared/ipc"
import type { BundledThemeID, Theme } from "../../../shared/theme"
import type { AvailableProject } from "../../../shared/project"
import {
  ApplicationStateResult,
  ProjectUIStateResult,
  type ApplicationState,
  type ProjectSelectionState,
  type ProjectUIState,
} from "../../../shared/applicationState"
import type { OpenCodeDiagnostics } from "../../../shared/openCode"
import {
  PaneDirection,
  type PaneDirection as PaneDirectionType,
  PaneSplitCommand,
  type PaneSplitCommand as PaneSplitCommandType,
} from "../../../shared/pane"

export class DesktopBridgeError extends Schema.TaggedErrorClass<DesktopBridgeError>()(
  "DesktopBridgeError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface DesktopBridgeShape {
  readonly loadTheme: Effect.Effect<Theme, DesktopBridgeError>
  readonly setBundledTheme: (id: BundledThemeID) => Effect.Effect<Theme, DesktopBridgeError>
  readonly selectProject: Effect.Effect<Option.Option<AvailableProject>, DesktopBridgeError>
  readonly listProjects: Effect.Effect<ReadonlyArray<AvailableProject>, DesktopBridgeError>
  readonly loadApplicationState: Effect.Effect<ApplicationState, DesktopBridgeError>
  readonly saveProjectSelection: (
    state: ProjectSelectionState,
  ) => Effect.Effect<ApplicationState, DesktopBridgeError>
  readonly saveProjectUIState: (
    state: ProjectUIState,
  ) => Effect.Effect<ProjectUIState, DesktopBridgeError>
  readonly getOpenCodeDiagnostics: Effect.Effect<OpenCodeDiagnostics, DesktopBridgeError>
  readonly installOpenCode: Effect.Effect<void, DesktopBridgeError>
  readonly openProject: (command: OpenProjectCommand) => Effect.Effect<string, DesktopBridgeError>
  readonly closeProject: (subscriptionID: string) => Effect.Effect<void, DesktopBridgeError>
  readonly selectSession: (
    command: ProjectSessionCommand,
  ) => Effect.Effect<void, DesktopBridgeError>
  readonly createSession: (
    command: CreateSessionCommand,
  ) => Effect.Effect<Exclude<CreateSessionResult, { readonly _tag: "Failure" }>, DesktopBridgeError>
  readonly submitPrompt: (command: SubmitPromptCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly replyQuestion: (command: ReplyQuestionCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly rejectQuestion: (command: QuestionCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly interrupt: (command: ProjectSessionCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly checkForUpdates: Effect.Effect<UpdateState, DesktopBridgeError>
  readonly installUpdate: Effect.Effect<void, DesktopBridgeError>
  readonly restartForUpdate: Effect.Effect<void, DesktopBridgeError>
  readonly subscribeUpdates: (
    onUpdate: (state: UpdateState) => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly subscribePaneSplits: (
    onSplit: (command: PaneSplitCommandType) => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly subscribePaneFocus: (
    onFocus: (direction: PaneDirectionType) => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly subscribePaneClose: (
    onClose: () => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly subscribePromptFocus: (
    onFocus: () => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly subscribeFollowLatest: (
    onFollow: () => void,
  ) => Effect.Effect<() => void, DesktopBridgeError>
  readonly watchProject: (
    subscriptionID: string,
    onUpdate: (update: ProjectUpdate) => void,
  ) => Effect.Effect<never, DesktopBridgeError>
}

export class DesktopBridge extends Context.Service<DesktopBridge, DesktopBridgeShape>()(
  "HydraCode/DesktopBridge",
) {}

const invoke = <S extends Schema.Top>(operation: () => Promise<unknown>, schema: S) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new DesktopBridgeError({
        message:
          cause instanceof Error && cause.message !== ""
            ? cause.message
            : "HydraCode could not communicate with the desktop process.",
        cause,
      }),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopBridgeError({
              message: "HydraCode received an invalid response from the desktop process.",
              cause,
            }),
        ),
      ),
    ),
  )
const command = (operation: () => Promise<unknown>) =>
  invoke(operation, ProjectCommandResult).pipe(
    Effect.flatMap((result) =>
      result._tag === "Success"
        ? Effect.void
        : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
    ),
  )

export const DesktopBridgeLive = Layer.sync(DesktopBridge, () =>
  DesktopBridge.of({
    loadTheme: invoke(() => window.hydracode.loadTheme(), ThemeResult).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(result.theme)
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    setBundledTheme: (id) =>
      invoke(() => window.hydracode.setBundledTheme({ theme: id }), ThemeResult).pipe(
        Effect.flatMap((result) =>
          result._tag === "Success"
            ? Effect.succeed(result.theme)
            : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
        ),
      ),
    selectProject: invoke(() => window.hydracode.selectProject(), ProjectSelectionResult).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(Option.fromNullishOr(result.project))
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    listProjects: invoke(() => window.hydracode.listProjects(), ListProjectsResult).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(result.projects)
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    loadApplicationState: invoke(
      () => window.hydracode.loadApplicationState(),
      ApplicationStateResult,
    ).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(result.state)
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    saveProjectSelection: (state) =>
      invoke(() => window.hydracode.saveProjectSelection(state), ApplicationStateResult).pipe(
        Effect.flatMap((result) =>
          result._tag === "Success"
            ? Effect.succeed(result.state)
            : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
        ),
      ),
    saveProjectUIState: (state) =>
      invoke(() => window.hydracode.saveProjectUIState(state), ProjectUIStateResult).pipe(
        Effect.flatMap((result) =>
          result._tag === "Success"
            ? Effect.succeed(result.state)
            : Effect.fail(
                new DesktopBridgeError({
                  message:
                    result._tag === "Failure"
                      ? result.message
                      : "HydraCode did not save the project UI state.",
                  cause: result,
                }),
              ),
        ),
      ),
    getOpenCodeDiagnostics: invoke(
      () => window.hydracode.getOpenCodeDiagnostics(),
      OpenCodeDiagnosticsResult,
    ).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(result.diagnostics)
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    installOpenCode: command(() => window.hydracode.installOpenCode()),
    openProject: (request) =>
      invoke(() => window.hydracode.openProject(request), OpenProjectResult).pipe(
        Effect.flatMap((value) =>
          "subscriptionID" in value
            ? Effect.succeed(value.subscriptionID)
            : Effect.fail(new DesktopBridgeError({ message: value.message, cause: value })),
        ),
      ),
    closeProject: (subscriptionID) =>
      command(() => window.hydracode.closeProject({ subscriptionID })),
    selectSession: (request) => command(() => window.hydracode.selectSession(request)),
    createSession: (request) =>
      invoke(() => window.hydracode.createSession(request), CreateSessionResult).pipe(
        Effect.flatMap((result) =>
          result._tag === "Failure"
            ? Effect.fail(new DesktopBridgeError({ message: result.message, cause: result }))
            : Effect.succeed(result),
        ),
      ),
    submitPrompt: (request) => command(() => window.hydracode.submitPrompt(request)),
    replyQuestion: (request) => command(() => window.hydracode.replyQuestion(request)),
    rejectQuestion: (request) => command(() => window.hydracode.rejectQuestion(request)),
    interrupt: (request) => command(() => window.hydracode.interrupt(request)),
    checkForUpdates: invoke(() => window.hydracode.checkForUpdates(), UpdateState),
    installUpdate: command(() => window.hydracode.installUpdate()),
    restartForUpdate: command(() => window.hydracode.restartForUpdate()),
    subscribeUpdates: (onUpdate) =>
      Effect.try({
        try: () =>
          window.hydracode.onUpdateState((state) => {
            onUpdate(Schema.decodeUnknownSync(UpdateState)(state))
          }),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to application updates.",
            cause,
          }),
      }),
    subscribePaneSplits: (onSplit) =>
      Effect.try({
        try: () =>
          window.hydracode.onPaneSplit((paneCommand) => {
            onSplit(Schema.decodeUnknownSync(PaneSplitCommand)(paneCommand))
          }),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to pane commands.",
            cause,
          }),
      }),
    subscribePaneFocus: (onFocus) =>
      Effect.try({
        try: () =>
          window.hydracode.onPaneFocus((direction) => {
            onFocus(Schema.decodeUnknownSync(PaneDirection)(direction))
          }),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to pane focus commands.",
            cause,
          }),
      }),
    subscribePaneClose: (onClose) =>
      Effect.try({
        try: () => window.hydracode.onPaneClose(onClose),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to pane close commands.",
            cause,
          }),
      }),
    subscribePromptFocus: (onFocus) =>
      Effect.try({
        try: () => window.hydracode.onPromptFocus(onFocus),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to prompt focus commands.",
            cause,
          }),
      }),
    subscribeFollowLatest: (onFollow) =>
      Effect.try({
        try: () => window.hydracode.onFollowLatest(onFollow),
        catch: (cause) =>
          new DesktopBridgeError({
            message: "HydraCode could not subscribe to follow-latest commands.",
            cause,
          }),
      }),
    watchProject: (subscriptionID, onUpdate) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          window.hydracode.onProjectUpdate((envelope) => {
            const decoded = Schema.decodeUnknownSync(ProjectUpdateEnvelope)(envelope)
            if (decoded.subscriptionID === subscriptionID) onUpdate(decoded.update)
          }),
        ),
        (remove) => Effect.sync(remove),
      )
        .pipe(
          Effect.flatMap(() => Effect.never),
          Effect.mapError(
            (cause) =>
              new DesktopBridgeError({
                message: "HydraCode could not subscribe to project updates.",
                cause,
              }),
          ),
        )
        .pipe(Effect.scoped),
  }),
)
