import { clipboard, dialog, ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import { IPC_CHANNELS, type AppLocale } from '../shared/contracts'
import type { AppServerClient } from './app-server-client'
import type { CodexRuntime } from './codex-runtime'
import type { SettingsStore } from './settings-store'
import type { ThreadService } from './thread-service'

function validIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid thread selection.')
  const ids = value.filter(
    (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128
  )
  if (ids.length !== value.length) throw new Error('Invalid thread selection.')
  return [...new Set(ids)]
}

export function registerIpcHandlers(
  service: ThreadService,
  settings: SettingsStore,
  runtime: CodexRuntime,
  client: AppServerClient
): void {
  ipcMain.handle(IPC_CHANNELS.environment, async () => (await runtime.probe(true)).status)
  ipcMain.handle(IPC_CHANNELS.listThreads, () => service.listThreads())
  ipcMain.handle(IPC_CHANNELS.deleteThreads, (_event, ids: unknown) =>
    service.deleteThreads(validIds(ids))
  )
  ipcMain.handle(IPC_CHANNELS.archiveThreads, (_event, ids: unknown) =>
    service.archiveThreads(validIds(ids))
  )
  ipcMain.handle(IPC_CHANNELS.unarchiveThreads, (_event, ids: unknown) =>
    service.unarchiveThreads(validIds(ids))
  )
  ipcMain.handle(IPC_CHANNELS.setPinned, (_event, ids: unknown, pinned: unknown) => {
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin state.')
    return service.setPinned(validIds(ids), pinned)
  })
  ipcMain.handle(IPC_CHANNELS.openWorkingDirectory, async (_event, path: unknown) => {
    if (
      typeof path !== 'string' ||
      path.length > 4096 ||
      !isAbsolute(path) ||
      !service.isKnownWorkingDirectory(path)
    ) {
      return 'The working directory is not part of the current thread inventory.'
    }
    const result = await shell.openPath(path)
    return result || null
  })
  ipcMain.handle(IPC_CHANNELS.copyThreadId, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 128 || !service.isKnownThreadId(id)) {
      throw new Error('The task ID is not part of the current inventory.')
    }
    clipboard.writeText(id)
  })
  ipcMain.handle(IPC_CHANNELS.chooseCliPath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Codex CLI',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'ps1'] }]
          : undefined
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.getSettings, () => settings.load())
  ipcMain.handle(IPC_CHANNELS.updateSettings, async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings update.')
    const input = patch as { locale?: unknown; customCliPath?: unknown }
    const update: { locale?: AppLocale; customCliPath?: string | null } = {}
    if (input.locale !== undefined) {
      if (input.locale !== 'en' && input.locale !== 'zh-CN') throw new Error('Invalid locale.')
      update.locale = input.locale
    }
    if (input.customCliPath !== undefined) {
      if (input.customCliPath !== null && typeof input.customCliPath !== 'string') {
        throw new Error('Invalid Codex CLI path.')
      }
      update.customCliPath = input.customCliPath
    }
    const updated = await settings.update(update)
    runtime.invalidate()
    client.stop()
    return updated
  })
}
