import { contextBridge, ipcRenderer } from "electron"
import { DesktopChannels } from "../shared/desktopChannels"
import type { HydraCodeDesktopApi } from "../shared/ipc"

const workspaceListeners = new Set<(update: unknown) => void>()
const pendingWorkspaceUpdates: Array<unknown> = []

ipcRenderer.on(DesktopChannels.workspaceUpdate, (_event, update: unknown) => {
  pendingWorkspaceUpdates.push(update)
  if (pendingWorkspaceUpdates.length > 512) pendingWorkspaceUpdates.shift()
  for (const listener of workspaceListeners) listener(update)
})

const desktopApi: HydraCodeDesktopApi = {
  platform: process.platform,
  loadTheme: () => ipcRenderer.invoke(DesktopChannels.loadTheme),
  selectWorkspace: () => ipcRenderer.invoke(DesktopChannels.selectWorkspace),
  openWorkspace: (command) => ipcRenderer.invoke(DesktopChannels.openWorkspace, command),
  closeWorkspace: (command) => ipcRenderer.invoke(DesktopChannels.closeWorkspace, command),
  submitPrompt: (command) => ipcRenderer.invoke(DesktopChannels.submitPrompt, command),
  interrupt: (command) => ipcRenderer.invoke(DesktopChannels.interrupt, command),
  onWorkspaceUpdate: (listener) => {
    workspaceListeners.add(listener)
    for (const update of pendingWorkspaceUpdates) listener(update)
    return () => workspaceListeners.delete(listener)
  },
}

contextBridge.exposeInMainWorld("hydracode", desktopApi)
