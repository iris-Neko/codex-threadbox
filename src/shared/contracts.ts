export type AppLocale = 'en' | 'zh-CN'

export type ThreadRuntimeStatus = 'notLoaded' | 'idle' | 'active' | 'systemError' | 'unknown'

export type IneligibleReason = 'active' | 'pinned' | null

export interface ThreadRecord {
  id: string
  title: string
  preview: string
  cwd: string
  createdAt: number
  updatedAt: number
  source: string
  archived: boolean
  pinned: boolean
  status: ThreadRuntimeStatus
  parentThreadId: string | null
  descendantCount: number
  internal: boolean
  ineligibleReason: IneligibleReason
}

export interface EnvironmentStatus {
  state: 'ready' | 'missing' | 'outdated' | 'error'
  cliPath: string | null
  cliVersion: string | null
  minimumVersion: string
  message: string | null
  externalCodexProcesses: number
  capabilities: {
    pinning: boolean
  }
}

export interface ListThreadsResult {
  threads: ThreadRecord[]
  environment: EnvironmentStatus
  refreshedAt: number
}

export interface OperationFailure {
  id: string
  message: string
}

export interface BatchOperationResult {
  succeeded: string[]
  failed: OperationFailure[]
  skipped: OperationFailure[]
  cascadedCount: number
  refreshedAt: number
}

export interface AppSettings {
  locale: AppLocale
  customCliPath: string | null
}

export interface ThreadboxApi {
  getEnvironmentStatus(): Promise<EnvironmentStatus>
  listThreads(): Promise<ListThreadsResult>
  deleteThreads(ids: string[]): Promise<BatchOperationResult>
  archiveThreads(ids: string[]): Promise<BatchOperationResult>
  unarchiveThreads(ids: string[]): Promise<BatchOperationResult>
  setPinned(ids: string[], pinned: boolean): Promise<BatchOperationResult>
  openWorkingDirectory(path: string): Promise<string | null>
  copyThreadId(id: string): Promise<void>
  chooseCliPath(): Promise<string | null>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}

export const IPC_CHANNELS = {
  environment: 'threadbox:environment',
  listThreads: 'threadbox:list-threads',
  deleteThreads: 'threadbox:delete-threads',
  archiveThreads: 'threadbox:archive-threads',
  unarchiveThreads: 'threadbox:unarchive-threads',
  setPinned: 'threadbox:set-pinned',
  openWorkingDirectory: 'threadbox:open-working-directory',
  copyThreadId: 'threadbox:copy-thread-id',
  chooseCliPath: 'threadbox:choose-cli-path',
  getSettings: 'threadbox:get-settings',
  updateSettings: 'threadbox:update-settings'
} as const
