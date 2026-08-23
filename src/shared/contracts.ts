export type AppLocale = 'en' | 'zh-CN'

export type ThreadRuntimeStatus = 'notLoaded' | 'idle' | 'active' | 'systemError' | 'unknown'

export type IneligibleReason = 'active' | 'pinned' | null

export interface ThreadRecord {
  id: string
  title: string
  preview: string
  cwd: string
  projectId: string | null
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
  desktopRecents: DesktopRecentsStatus
  refreshedAt: number
}

export interface DesktopRecentsEntry {
  id: string
  title: string
}

export interface DesktopRecentsStatus {
  state: 'clean' | 'stale' | 'unavailable' | 'error'
  staleCount: number
  staleEntries: DesktopRecentsEntry[]
  message: string | null
}

export interface DesktopRecentsCleanupResult {
  removed: number
  backupPath: string | null
  error: string | null
}

export interface DesktopRecentsRepairResult {
  removed: number
  backupPath: string | null
  status: DesktopRecentsStatus
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
  directoryCleanup?: WorkingDirectoryCleanupResult
  desktopRecentsCleanup?: DesktopRecentsCleanupResult
}

export interface WorkingDirectoryIssue {
  path: string
  message: string
}

export interface WorkingDirectoryCleanupResult {
  requested: string[]
  trashed: string[]
  failed: WorkingDirectoryIssue[]
  skipped: WorkingDirectoryIssue[]
}

export interface DeleteThreadsOptions {
  trashWorkingDirectories: string[]
}

export interface AppSettings {
  locale: AppLocale
  customCliPath: string | null
}

export interface ThreadboxApi {
  getEnvironmentStatus(): Promise<EnvironmentStatus>
  listThreads(): Promise<ListThreadsResult>
  deleteThreads(ids: string[], options: DeleteThreadsOptions): Promise<BatchOperationResult>
  repairDesktopRecents(): Promise<DesktopRecentsRepairResult>
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
  repairDesktopRecents: 'threadbox:repair-desktop-recents',
  archiveThreads: 'threadbox:archive-threads',
  unarchiveThreads: 'threadbox:unarchive-threads',
  setPinned: 'threadbox:set-pinned',
  openWorkingDirectory: 'threadbox:open-working-directory',
  copyThreadId: 'threadbox:copy-thread-id',
  chooseCliPath: 'threadbox:choose-cli-path',
  getSettings: 'threadbox:get-settings',
  updateSettings: 'threadbox:update-settings'
} as const
