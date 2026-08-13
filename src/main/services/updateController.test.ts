import { expect, it, vi } from "vitest"
import { createUpdateController, type UpdateBackend } from "./updateController"

function backend(overrides: Partial<UpdateBackend> = {}): UpdateBackend {
  return {
    currentVersion: "0.1.0",
    checkForUpdates: vi.fn().mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: "0.2.0" },
    }),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    ...overrides,
  }
}

it("reports an available update, prepares it on install, and waits for restart", async () => {
  const updateBackend = backend()
  const controller = createUpdateController({ enabled: true, backend: updateBackend })
  const states: Array<string> = []
  controller.subscribe((state) => states.push(state.status))

  await expect(controller.check()).resolves.toEqual({ status: "available", version: "0.2.0" })
  expect(states).toEqual(["idle", "checking", "available"])
  expect(updateBackend.downloadUpdate).not.toHaveBeenCalled()

  await expect(controller.install()).resolves.toEqual({ status: "ready", version: "0.2.0" })
  expect(updateBackend.downloadUpdate).toHaveBeenCalledOnce()
  expect(updateBackend.quitAndInstall).not.toHaveBeenCalled()

  expect(controller.restart()).toBe(true)
  expect(updateBackend.quitAndInstall).toHaveBeenCalledOnce()
})

it("reports when the current version is up to date", async () => {
  const controller = createUpdateController({
    enabled: true,
    backend: backend({
      checkForUpdates: vi.fn().mockResolvedValue({
        isUpdateAvailable: false,
        updateInfo: { version: "0.1.0" },
      }),
    }),
  })

  await expect(controller.check()).resolves.toEqual({ status: "up-to-date" })
})

it("reports a failed update download without restarting", async () => {
  const updateBackend = backend({
    downloadUpdate: vi.fn().mockRejectedValue(new Error("Download failed")),
  })
  const controller = createUpdateController({ enabled: true, backend: updateBackend })

  await controller.check()
  await expect(controller.install()).resolves.toEqual({
    status: "error",
    message: "Download failed",
  })
  expect(controller.restart()).toBe(false)
  expect(updateBackend.quitAndInstall).not.toHaveBeenCalled()
})

it("deduplicates concurrent checks", async () => {
  let resolveCheck: ((value: null) => void) | undefined
  const checkForUpdates = vi.fn(() => new Promise<null>((resolve) => (resolveCheck = resolve)))
  const controller = createUpdateController({
    enabled: true,
    backend: backend({ checkForUpdates }),
  })

  const first = controller.check()
  const second = controller.check()
  resolveCheck?.(null)

  await Promise.all([first, second])
  expect(checkForUpdates).toHaveBeenCalledOnce()
})

it("stays disabled outside packaged releases", async () => {
  const updateBackend = backend()
  const controller = createUpdateController({ enabled: false, backend: updateBackend })

  await expect(controller.check()).resolves.toEqual({ status: "disabled" })
  expect(updateBackend.checkForUpdates).not.toHaveBeenCalled()
})

it("suppresses errors from automatic background checks", async () => {
  const controller = createUpdateController({
    enabled: true,
    backend: backend({ checkForUpdates: vi.fn().mockRejectedValue(new Error("No release")) }),
  })

  await expect(controller.check({ silent: true })).resolves.toEqual({ status: "idle" })
  await expect(controller.check()).resolves.toEqual({ status: "error", message: "No release" })
})
