import { app } from "electron"
import electronUpdater from "electron-updater"
import { Context, Effect, Layer, Schema } from "effect"
import type { UpdateState } from "../../shared/update"
import { createUpdateController } from "./updateController"

const { autoUpdater } = electronUpdater

export class UpdateServiceError extends Schema.TaggedErrorClass<UpdateServiceError>()(
  "UpdateServiceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

interface UpdateServiceShape {
  readonly check: Effect.Effect<UpdateState>
  readonly checkSilently: Effect.Effect<UpdateState>
  readonly install: Effect.Effect<void, UpdateServiceError>
  readonly subscribe: (listener: (state: UpdateState) => void) => Effect.Effect<() => void>
}

export class UpdateService extends Context.Service<UpdateService, UpdateServiceShape>()(
  "HydraCode/UpdateService",
) {}

export const UpdateServiceLive = Layer.sync(UpdateService, () => {
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const controller = createUpdateController({
    enabled: app?.isPackaged ?? false,
    backend: {
      currentVersion: app?.getVersion() ?? "0.0.0",
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    },
  })

  return UpdateService.of({
    check: Effect.promise(() => controller.check()),
    checkSilently: Effect.promise(() => controller.check({ silent: true })),
    install: Effect.try({
      try: () => {
        if (!controller.install()) throw new Error("No update is ready to install.")
      },
      catch: (cause) =>
        new UpdateServiceError({ message: "HydraCode could not install the update.", cause }),
    }),
    subscribe: (listener) => Effect.sync(() => controller.subscribe(listener)),
  })
})
