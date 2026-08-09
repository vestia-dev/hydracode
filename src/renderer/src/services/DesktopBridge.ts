import { Context, Effect, Layer, Option, Schema } from "effect"
import {
  WorkspaceUpdateEnvelope,
  WorkspaceUpdate,
  WorkspaceCommandResult,
  OpenWorkspaceResult,
  type OpenWorkspaceCommand,
  type SubmitPromptCommand,
  type WorkspaceSessionCommand,
} from "../../../shared/ipc"
import { ThemeResult, WorkspaceSelectionResult } from "../../../shared/ipc"
import type { Theme } from "../../../shared/theme"

export class DesktopBridgeError extends Schema.TaggedErrorClass<DesktopBridgeError>()(
  "DesktopBridgeError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface DesktopBridgeShape {
  readonly loadTheme: Effect.Effect<Theme, DesktopBridgeError>
  readonly selectWorkspace: Effect.Effect<Option.Option<string>, DesktopBridgeError>
  readonly openWorkspace: (
    command: OpenWorkspaceCommand,
  ) => Effect.Effect<string, DesktopBridgeError>
  readonly closeWorkspace: (subscriptionID: string) => Effect.Effect<void, DesktopBridgeError>
  readonly submitPrompt: (command: SubmitPromptCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly interrupt: (command: WorkspaceSessionCommand) => Effect.Effect<void, DesktopBridgeError>
  readonly watchWorkspace: (
    subscriptionID: string,
    onUpdate: (update: WorkspaceUpdate) => void,
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
  invoke(operation, WorkspaceCommandResult).pipe(
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
    selectWorkspace: invoke(
      () => window.hydracode.selectWorkspace(),
      WorkspaceSelectionResult,
    ).pipe(
      Effect.flatMap((result) =>
        result._tag === "Success"
          ? Effect.succeed(Option.fromNullishOr(result.directory))
          : Effect.fail(new DesktopBridgeError({ message: result.message, cause: result })),
      ),
    ),
    openWorkspace: (request) =>
      invoke(() => window.hydracode.openWorkspace(request), OpenWorkspaceResult).pipe(
        Effect.flatMap((value) =>
          "subscriptionID" in value
            ? Effect.succeed(value.subscriptionID)
            : Effect.fail(new DesktopBridgeError({ message: value.message, cause: value })),
        ),
      ),
    closeWorkspace: (subscriptionID) =>
      command(() => window.hydracode.closeWorkspace({ subscriptionID })),
    submitPrompt: (request) => command(() => window.hydracode.submitPrompt(request)),
    interrupt: (request) => command(() => window.hydracode.interrupt(request)),
    watchWorkspace: (subscriptionID, onUpdate) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          window.hydracode.onWorkspaceUpdate((envelope) => {
            const decoded = Schema.decodeUnknownSync(WorkspaceUpdateEnvelope)(envelope)
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
                message: "HydraCode could not subscribe to workspace updates.",
                cause,
              }),
          ),
        )
        .pipe(Effect.scoped),
  }),
)
