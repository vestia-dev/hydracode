import { contextBridge, ipcRenderer } from "electron"
import { DesktopChannels } from "../shared/desktopChannels"
import type { HydraCodeDesktopApi } from "../shared/ipc"

const projectUpdateListeners = new Set<(update: unknown) => void>()
const updateListeners = new Set<(state: unknown) => void>()
const paneSplitListeners = new Set<(command: "right" | "down" | "left" | "up") => void>()
const paneFocusListeners = new Set<(direction: "right" | "down" | "left" | "up") => void>()
const paneCloseListeners = new Set<() => void>()
const promptFocusListeners = new Set<() => void>()
const followLatestListeners = new Set<() => void>()
let updateSubscription: Promise<unknown> | undefined

ipcRenderer.on(DesktopChannels.updateState, (_event, state: unknown) => {
  for (const listener of updateListeners) listener(state)
})

ipcRenderer.on(DesktopChannels.projectUpdate, (_event, input: unknown) => {
  for (const listener of projectUpdateListeners) listener(input)
})

ipcRenderer.on(DesktopChannels.paneSplit, (_event, command: "right" | "down" | "left" | "up") => {
  for (const listener of paneSplitListeners) listener(command)
})

ipcRenderer.on(DesktopChannels.paneFocus, (_event, direction: "right" | "down" | "left" | "up") => {
  for (const listener of paneFocusListeners) listener(direction)
})

ipcRenderer.on(DesktopChannels.paneClose, () => {
  for (const listener of paneCloseListeners) listener()
})

ipcRenderer.on(DesktopChannels.promptFocus, () => {
  for (const listener of promptFocusListeners) listener()
})

ipcRenderer.on(DesktopChannels.followLatest, () => {
  for (const listener of followLatestListeners) listener()
})

const desktopApi: HydraCodeDesktopApi = {
  platform: process.platform,
  loadTheme: () => ipcRenderer.invoke(DesktopChannels.loadTheme),
  setBundledTheme: (command) => ipcRenderer.invoke(DesktopChannels.setBundledTheme, command),
  selectProject: () => ipcRenderer.invoke(DesktopChannels.selectProject),
  listProjects: () => ipcRenderer.invoke(DesktopChannels.listProjects),
  loadApplicationState: () => ipcRenderer.invoke(DesktopChannels.loadApplicationState),
  saveProjectSelection: (state) => ipcRenderer.invoke(DesktopChannels.saveProjectSelection, state),
  saveProjectUIState: (state) => ipcRenderer.invoke(DesktopChannels.saveProjectUIState, state),
  openProject: (command) => ipcRenderer.invoke(DesktopChannels.openProject, command),
  listProjectSessions: (command) =>
    ipcRenderer.invoke(DesktopChannels.listProjectSessions, command),
  listActiveSessions: () => ipcRenderer.invoke(DesktopChannels.listActiveSessions),
  selectSession: (command) => ipcRenderer.invoke(DesktopChannels.selectSession, command),
  createSession: (command) => ipcRenderer.invoke(DesktopChannels.createSession, command),
  submitPrompt: (command) => ipcRenderer.invoke(DesktopChannels.submitPrompt, command),
  updateSessionInbox: (command) => ipcRenderer.invoke(DesktopChannels.updateSessionInbox, command),
  replyQuestion: (command) => ipcRenderer.invoke(DesktopChannels.replyQuestion, command),
  rejectQuestion: (command) => ipcRenderer.invoke(DesktopChannels.rejectQuestion, command),
  backgroundSession: (command) => ipcRenderer.invoke(DesktopChannels.backgroundSession, command),
  interrupt: (command) => ipcRenderer.invoke(DesktopChannels.interrupt, command),
  getOpenCodeDiagnostics: () => ipcRenderer.invoke(DesktopChannels.openCodeDiagnostics),
  installOpenCode: () => ipcRenderer.invoke(DesktopChannels.installOpenCode),
  checkForUpdates: () => ipcRenderer.invoke(DesktopChannels.updateCheck),
  installUpdate: () => ipcRenderer.invoke(DesktopChannels.updateInstall),
  restartForUpdate: () => ipcRenderer.invoke(DesktopChannels.updateRestart),
  onUpdateState: (listener) => {
    updateListeners.add(listener)
    updateSubscription ??= ipcRenderer.invoke(DesktopChannels.updateSubscribe)
    return () => updateListeners.delete(listener)
  },
  onProjectUpdate: (listener) => {
    projectUpdateListeners.add(listener)
    return () => projectUpdateListeners.delete(listener)
  },
  onPaneSplit: (listener) => {
    paneSplitListeners.add(listener)
    return () => paneSplitListeners.delete(listener)
  },
  onPaneFocus: (listener) => {
    paneFocusListeners.add(listener)
    return () => paneFocusListeners.delete(listener)
  },
  onPaneClose: (listener) => {
    paneCloseListeners.add(listener)
    return () => paneCloseListeners.delete(listener)
  },
  onPromptFocus: (listener) => {
    promptFocusListeners.add(listener)
    return () => promptFocusListeners.delete(listener)
  },
  onFollowLatest: (listener) => {
    followLatestListeners.add(listener)
    return () => followLatestListeners.delete(listener)
  },
}

contextBridge.exposeInMainWorld("hydracode", desktopApi)
