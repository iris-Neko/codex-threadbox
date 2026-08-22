import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppSettings, type ThreadboxApi } from '../shared/contracts'

const api: ThreadboxApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke(IPC_CHANNELS.environment),
  listThreads: () => ipcRenderer.invoke(IPC_CHANNELS.listThreads),
  deleteThreads: (ids) => ipcRenderer.invoke(IPC_CHANNELS.deleteThreads, ids),
  archiveThreads: (ids) => ipcRenderer.invoke(IPC_CHANNELS.archiveThreads, ids),
  unarchiveThreads: (ids) => ipcRenderer.invoke(IPC_CHANNELS.unarchiveThreads, ids),
  setPinned: (ids, pinned) => ipcRenderer.invoke(IPC_CHANNELS.setPinned, ids, pinned),
  openWorkingDirectory: (path) => ipcRenderer.invoke(IPC_CHANNELS.openWorkingDirectory, path),
  copyThreadId: (id) => ipcRenderer.invoke(IPC_CHANNELS.copyThreadId, id),
  chooseCliPath: () => ipcRenderer.invoke(IPC_CHANNELS.chooseCliPath),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch)
}

contextBridge.exposeInMainWorld('threadbox', api)
