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
  type ProjectSessionCommand,
  UpdateState,
} from "../../../shared/ipc"
import { ThemeResult, ProjectSelectionResult } from "../../../shared/ipc"
import type { Theme } from "../../../shared/theme"
import type { ProjectCatalogItem } from "../../../shared/project"

export class DesktopBridgeError extends Schema.TaggedErrorClass<DesktopBridgeError>()(
  "DesktopBridgeError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface DesktopBridgeShape {
  readonly loadTheme: Effect.Effect<Theme, DesktopBridgeError>
  readonly selectProject: Effect.Effect<Option.Option<string>, DesktopBridgeError>
  readonly listProjects: Effect.Effect<ReadonlyArray<ProjectCatalogItem>, DesktopBridgeError>
  readonly openProject: (command: OpenProjectCommand) => Effect.Effect<string, DesktopBridgeError>
  readonly closeProject: (subscriptionID: string) => Effect.Effect<void, DesktopBridgeError>
  readonly selectSession: (
    command: ProjectSessionCommand,
  ) => Effect.Effect<void, DesktopBridgeError>
  readonly createSession: (
    command: CreateSessionCommand,
  ) => Effect.Effect<Exclude<CreateSessionResult, { readonly _tag: "Failure" }>, DesktopBridgeError>
  readonly submitPrompt: (command: SubmitPromptCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly interrupt: (command: ProjectSessionCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly checkForUpdates: Effect.Effect<UpdateState, DesktopBridgeError>
  readonly installUpdate: Effect.Effect<void, DesktopBridgeError>
  readonly subscribeUpdates: (
    onUpdate: (state: UpdateState) => void,
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
    selectProject: invoke(() => window.hydracode.selectProject(), ProjectSelectionResult).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(Option.fromNullishOr(result.directory))
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
    interrupt: (request) => command(() => window.hydracode.interrupt(request)),
    checkForUpdates: invoke(() => window.hydracode.checkForUpdates(), UpdateState),
    installUpdate: command(() => window.hydracode.installUpdate()),
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
