import { join } from "node:path"
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron"
import { Data, Effect } from "effect"
import { DefaultTheme } from "../shared/theme"
import { DesktopChannels } from "../shared/desktopChannels"
import { registerDesktopIpc } from "./ipc"
import { MainRuntime } from "./runtime"
import { UpdateService } from "./services/UpdateService"

app.setName("HydraCode")

class ProjectWindowLoadError extends Data.TaggedError("ProjectWindowLoadError")<{
  readonly cause: unknown
}> {}

const createProjectWindow = Effect.gen(function* () {
  const window = yield* Effect.sync(
    () =>
      new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 880,
        minHeight: 600,
        backgroundColor: DefaultTheme.colors.background,
        show: false,
        ...(process.platform === "darwin"
          ? {
              titleBarStyle: "hidden" as const,
              trafficLightPosition: { x: 14, y: 17 },
            }
          : {}),
        webPreferences: {
          preload: join(__dirname, "../preload/index.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }),
  )

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.alt || !input.shift) return
    const primaryModifier = process.platform === "darwin" ? input.meta : input.control
    const secondaryModifier = process.platform === "darwin" ? input.control : input.meta
    if (!primaryModifier || secondaryModifier) return
    const direction = paneNavigationDirection(input.key)
    if (direction === undefined) return
    event.preventDefault()
    window.webContents.send(DesktopChannels.paneFocus, direction)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  return yield* Effect.tryPromise({
    try: () =>
      rendererUrl !== undefined
        ? window.loadURL(rendererUrl)
        : window.loadFile(join(__dirname, "../renderer/index.html")),
    catch: (cause) => new ProjectWindowLoadError({ cause }),
  }).pipe(
    Effect.as(window),
    Effect.tapError(() =>
      Effect.sync(() => {
        if (!window.isDestroyed()) window.destroy()
      }),
    ),
  )
})

const sendPaneSplit = (command: "right" | "down" | "left" | "up") => {
  BrowserWindow.getFocusedWindow()?.webContents.send(DesktopChannels.paneSplit, command)
}

const paneNavigationDirection = (key: string): "right" | "down" | "left" | "up" | undefined => {
  switch (key.toLowerCase()) {
    case "arrowleft":
    case "h":
      return "left"
    case "arrowdown":
    case "j":
      return "down"
    case "arrowup":
    case "k":
      return "up"
    case "arrowright":
    case "l":
      return "right"
    default:
      return undefined
  }
}

const sendPaneFocus = (direction: "right" | "down" | "left" | "up") => {
  BrowserWindow.getFocusedWindow()?.webContents.send(DesktopChannels.paneFocus, direction)
}

const sendPaneClose = () => {
  BrowserWindow.getFocusedWindow()?.webContents.send(DesktopChannels.paneClose)
}

const sendPromptFocus = () => {
  BrowserWindow.getFocusedWindow()?.webContents.send(DesktopChannels.promptFocus)
}

const sendFollowLatest = () => {
  BrowserWindow.getFocusedWindow()?.webContents.send(DesktopChannels.followLatest)
}

const installApplicationMenu = () => {
  const splitItems: MenuItemConstructorOptions[] = [
    {
      label: "Split Pane Right",
      accelerator: "CommandOrControl+D",
      click: () => sendPaneSplit("right"),
    },
    {
      label: "Split Pane Down",
      accelerator: "CommandOrControl+Shift+D",
      click: () => sendPaneSplit("down"),
    },
    { type: "separator" },
    { label: "Split Pane Left", click: () => sendPaneSplit("left") },
    { label: "Split Pane Up", click: () => sendPaneSplit("up") },
  ]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...splitItems,
        { type: "separator" },
        {
          label: "Focus Pane Left",
          accelerator: "CommandOrControl+Shift+Left",
          click: () => sendPaneFocus("left"),
        },
        {
          label: "Focus Pane Down",
          accelerator: "CommandOrControl+Shift+Down",
          click: () => sendPaneFocus("down"),
        },
        {
          label: "Focus Pane Up",
          accelerator: "CommandOrControl+Shift+Up",
          click: () => sendPaneFocus("up"),
        },
        {
          label: "Focus Pane Right",
          accelerator: "CommandOrControl+Shift+Right",
          click: () => sendPaneFocus("right"),
        },
        { type: "separator" },
        {
          label: "Focus Prompt",
          accelerator: "CommandOrControl+I",
          click: sendPromptFocus,
        },
        {
          label: "Follow Latest",
          accelerator: "CommandOrControl+E",
          click: sendFollowLatest,
        },
        { type: "separator" },
        {
          label: "Close Pane",
          accelerator: "CommandOrControl+W",
          click: sendPaneClose,
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const start = Effect.gen(function* () {
  yield* Effect.promise(() => app.whenReady())
  if (!app.isPackaged && process.platform === "darwin") {
    app.dock?.setIcon(join(app.getAppPath(), "build/icon.png"))
  }
  registerDesktopIpc()
  installApplicationMenu()
  yield* createProjectWindow

  MainRuntime.runFork(
    Effect.forever(
      UpdateService.use((updates) => updates.checkSilently).pipe(
        Effect.catch((error) => Effect.logError("Automatic update check failed", error)),
        Effect.andThen(Effect.sleep("10 minutes")),
      ),
    ),
  )

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      MainRuntime.runFork(
        createProjectWindow.pipe(
          Effect.catch((error) => Effect.logError("Failed to load project window", error)),
        ),
      )
    }
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  let shutdownState: "active" | "disposing" | "disposed" = "active"
  app.on("before-quit", (event) => {
    if (shutdownState === "disposed") return
    event.preventDefault()
    if (shutdownState === "disposing") return
    shutdownState = "disposing"
    void MainRuntime.dispose()
      .catch((cause: unknown) => console.error("Failed to release application services", cause))
      .finally(() => {
        shutdownState = "disposed"
        app.quit()
      })
  })
})

Effect.runFork(start)
