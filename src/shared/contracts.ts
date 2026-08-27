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
  inventory: {
    state: 'complete' | 'partial'
    message: string | null
  }
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

export interface DeletePreviewRoot {
  id: string
  title: string
  cwd: string
  descendantCount: number
}

export interface DeletePreview {
  requestedIds: string[]
  roots: DeletePreviewRoot[]
  skipped: OperationFailure[]
  cascadedCount: number
  refreshedAt: number
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

export type ProjectKind = 'threadbox' | 'official'

export type ProjectSystemKind = 'trash'

export interface ProjectRecord {
  id: string
  name: string
  kind: ProjectKind
  systemKind?: ProjectSystemKind | null
  readOnly: boolean
  codexProjectId: string | null
  roots: string[]
  canCreateThread: boolean
  createThreadUnavailableReason: string | null
  createdAt: number | null
  updatedAt: number | null
}

export interface ProjectSnapshot {
  projects: ProjectRecord[]
  assignments: Record<string, string>
  refreshedAt: number
}

export interface PlatformCapabilities {
  host: 'desktop' | 'vscode'
  projectManagement: boolean
  desktopRecentsRepair: boolean
  directoryTrash: boolean
  chooseCliPath: boolean
  openWorkingDirectory: boolean
  currentWorkspaceDirectories: string[]
  projectThreadCreation?: boolean
  taskTrash?: boolean
  workspaceProjectImport?: boolean
}

export interface CreatedProjectThread {
  threadId: string
  name: string
  cwd: string
  projectId: string
}

export interface ThreadboxApi {
  getPlatformCapabilities(): Promise<PlatformCapabilities>
  getEnvironmentStatus(): Promise<EnvironmentStatus>
  listThreads(): Promise<ListThreadsResult>
  deleteThreads(ids: string[], options: DeleteThreadsOptions): Promise<BatchOperationResult>
  trashThreads?(ids: string[]): Promise<BatchOperationResult>
  restoreThreadsFromTrash?(ids: string[]): Promise<BatchOperationResult>
  emptyTrash?(): Promise<BatchOperationResult>
  repairDesktopRecents(): Promise<DesktopRecentsRepairResult>
  archiveThreads(ids: string[]): Promise<BatchOperationResult>
  unarchiveThreads(ids: string[]): Promise<BatchOperationResult>
  setPinned(ids: string[], pinned: boolean): Promise<BatchOperationResult>
  listProjects(): Promise<ProjectSnapshot>
  createProject(name: string): Promise<ProjectSnapshot>
  importCurrentWorkspaceProject?(): Promise<ProjectSnapshot | null>
  renameProject(id: string, name: string): Promise<ProjectSnapshot>
  deleteProject(id: string): Promise<ProjectSnapshot>
  assignThreads(ids: string[], projectId: string | null): Promise<ProjectSnapshot>
  createThreadInProject?(
    projectId: string,
    name: string
  ): Promise<CreatedProjectThread | null>
  openWorkingDirectory(path: string): Promise<string | null>
  copyThreadId(id: string): Promise<void>
  chooseCliPath(): Promise<string | null>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
}

export const IPC_CHANNELS = {
  platformCapabilities: 'threadbox:platform-capabilities',
  environment: 'threadbox:environment',
  listThreads: 'threadbox:list-threads',
  deleteThreads: 'threadbox:delete-threads',
  repairDesktopRecents: 'threadbox:repair-desktop-recents',
  archiveThreads: 'threadbox:archive-threads',
  unarchiveThreads: 'threadbox:unarchive-threads',
  setPinned: 'threadbox:set-pinned',
  listProjects: 'threadbox:list-projects',
  createProject: 'threadbox:create-project',
  renameProject: 'threadbox:rename-project',
  deleteProject: 'threadbox:delete-project',
  assignThreads: 'threadbox:assign-threads',
  openWorkingDirectory: 'threadbox:open-working-directory',
  copyThreadId: 'threadbox:copy-thread-id',
  chooseCliPath: 'threadbox:choose-cli-path',
  getSettings: 'threadbox:get-settings',
  updateSettings: 'threadbox:update-settings'
} as const
