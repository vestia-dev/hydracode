import { contextBridge, ipcRenderer } from "electron"
import { DesktopChannels } from "../shared/desktopChannels"
import type { HydraCodeDesktopApi } from "../shared/ipc"

const projectListeners = new Set<(update: unknown) => void>()
const pendingProjectUpdates: Array<unknown> = []
const updateListeners = new Set<(state: unknown) => void>()
let updateSubscription: Promise<unknown> | undefined

ipcRenderer.on(DesktopChannels.updateState, (_event, state: unknown) => {
  for (const listener of updateListeners) listener(state)
})

ipcRenderer.on(DesktopChannels.projectUpdate, (_event, update: unknown) => {
  pendingProjectUpdates.push(update)
  if (pendingProjectUpdates.length > 512) pendingProjectUpdates.shift()
  for (const listener of projectListeners) listener(update)
})

const desktopApi: HydraCodeDesktopApi = {
  platform: process.platform,
  loadTheme: () => ipcRenderer.invoke(DesktopChannels.loadTheme),
  selectProject: () => ipcRenderer.invoke(DesktopChannels.selectProject),
  listProjects: () => ipcRenderer.invoke(DesktopChannels.listProjects),
  openProject: (command) => ipcRenderer.invoke(DesktopChannels.openProject, command),
  closeProject: (command) => ipcRenderer.invoke(DesktopChannels.closeProject, command),
  selectSession: (command) => ipcRenderer.invoke(DesktopChannels.selectSession, command),
  createSession: (command) => ipcRenderer.invoke(DesktopChannels.createSession, command),
  submitPrompt: (command) => ipcRenderer.invoke(DesktopChannels.submitPrompt, command),
  interrupt: (command) => ipcRenderer.invoke(DesktopChannels.interrupt, command),
  checkForUpdates: () => ipcRenderer.invoke(DesktopChannels.updateCheck),
  installUpdate: () => ipcRenderer.invoke(DesktopChannels.updateInstall),
  onUpdateState: (listener) => {
    updateListeners.add(listener)
    updateSubscription ??= ipcRenderer.invoke(DesktopChannels.updateSubscribe)
    return () => updateListeners.delete(listener)
  },
  onProjectUpdate: (listener) => {
    projectListeners.add(listener)
    for (const update of pendingProjectUpdates) listener(update)
    return () => projectListeners.delete(listener)
  },
}

contextBridge.exposeInMainWorld("hydracode", desktopApi)
