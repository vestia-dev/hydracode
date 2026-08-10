import { Context, Effect, Layer, Schema } from "effect"
import { dialog } from "electron"

export class DesktopServiceError extends Schema.TaggedErrorClass<DesktopServiceError>()(
  "DesktopServiceError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

interface DesktopServiceShape {
  readonly selectProject: Effect.Effect<string | null, DesktopServiceError>
}

export class DesktopService extends Context.Service<DesktopService, DesktopServiceShape>()(
  "HydraCode/DesktopService",
) {}

export const DesktopServiceLive = Layer.succeed(
  DesktopService,
  DesktopService.of({
    selectProject: Effect.tryPromise({
      try: () =>
        dialog.showOpenDialog({
          title: "Open a project",
          buttonLabel: "Open project",
          properties: ["openDirectory", "createDirectory"],
        }),
      catch: (cause) =>
        new DesktopServiceError({
          message: "HydraCode could not open the project picker.",
          cause,
        }),
    }).pipe(Effect.map((result) => (result.canceled ? null : (result.filePaths[0] ?? null)))),
  }),
)
