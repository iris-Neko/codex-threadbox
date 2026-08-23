import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThreadboxApp } from '../../ui/src/index'
import '../../ui/src/i18n'
import '../../ui/src/styles-v2.css'
import type {
  AppSettings,
  DeleteThreadsOptions,
  ThreadboxApi
} from '../../../src/shared/contracts'
import type { RpcMethod, RpcResponse } from './rpc'

interface VsCodeApi {
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
let sequence = 0
const pending = new Map<string, {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: number
}>()

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const response = event.data as Partial<RpcResponse>
  if (response?.kind !== 'threadbox.response' || typeof response.id !== 'string') return
  const request = pending.get(response.id)
  if (!request) return
  pending.delete(response.id)
  window.clearTimeout(request.timer)
  if (response.ok) request.resolve(response.value)
  else request.reject(new Error(response.error ?? 'Threadbox request failed.'))
})

function invoke<T>(method: RpcMethod, ...args: unknown[]): Promise<T> {
  const id = `${Date.now().toString(36)}-${(++sequence).toString(36)}`
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Threadbox request timed out: ${method}`))
    }, 120_000)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
    vscode.postMessage({ kind: 'threadbox.request', id, method, args })
  })
}

const api: ThreadboxApi = {
  getPlatformCapabilities: () => invoke('getPlatformCapabilities'),
  getEnvironmentStatus: () => invoke('getEnvironmentStatus'),
  listThreads: () => invoke('listThreads'),
  deleteThreads: (ids: string[], options: DeleteThreadsOptions) =>
    invoke('deleteThreads', ids, options),
  repairDesktopRecents: () => invoke('repairDesktopRecents'),
  archiveThreads: (ids) => invoke('archiveThreads', ids),
  unarchiveThreads: (ids) => invoke('unarchiveThreads', ids),
  setPinned: (ids, pinned) => invoke('setPinned', ids, pinned),
  openWorkingDirectory: (path) => invoke('openWorkingDirectory', path),
  copyThreadId: (id) => invoke('copyThreadId', id),
  chooseCliPath: () => invoke('chooseCliPath'),
  getSettings: () => invoke('getSettings'),
  updateSettings: (patch: Partial<AppSettings>) => invoke('updateSettings', patch)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThreadboxApp api={api} />
  </StrictMode>
)
