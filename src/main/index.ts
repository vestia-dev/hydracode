import { join } from "node:path"
import { app, BrowserWindow } from "electron"
import { Effect } from "effect"
import { DefaultTheme } from "../shared/theme"
import { registerDesktopIpc } from "./ipc"
import { MainRuntime } from "./runtime"
import { UpdateService } from "./services/UpdateService"

const createProjectWindow = Effect.sync(() => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: DefaultTheme.colors.background,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }

  return window
})

const start = Effect.gen(function* () {
  yield* Effect.promise(() => app.whenReady())
  registerDesktopIpc()
  yield* createProjectWindow

  MainRuntime.runFork(UpdateService.use((updates) => updates.checkSilently))
  const updateTimer = setInterval(
    () => MainRuntime.runFork(UpdateService.use((updates) => updates.checkSilently)),
    10 * 60 * 1000,
  )
  updateTimer.unref()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      Effect.runSync(createProjectWindow)
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("will-quit", () => {
    clearInterval(updateTimer)
    void MainRuntime.dispose()
  })
})

Effect.runFork(start)
