import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import * as vscode from 'vscode'
import {
  AppServerClient,
  CodexRuntime,
  ThreadService,
  type ThreadListOptions
} from '../../core/src/index'
import type {
  AppLocale,
  AppSettings,
  BatchOperationResult,
  DesktopRecentsRepairResult,
  EnvironmentStatus,
  PlatformCapabilities,
  ThreadboxApi
} from '../../../src/shared/contracts'
import { DoubleClickGate } from './double-click'
import {
  chooseProjectDirectory,
  createProjectThread
} from './codex-projects'
import {
  CodexCliPermissionError,
  CodexCliUpdater,
  NPM_UNINSTALL_COMMAND,
  SUDO_NPM_UNINSTALL_COMMAND,
  SUDO_NPM_UPDATE_COMMAND
} from './codex-update'
import { ProjectStore } from './project-store'
import { SidebarItem, ThreadboxSidebarProvider } from './sidebar'
import {
  CODEX_PRIMARY_CONTAINER,
  CODEX_SECONDARY_CONTAINER,
  findKnownCodexViewContainers
} from './sidebar-location'
import { migrateLegacyProjectStorage } from './storage-migration'
import { TrashController } from './trash-controller'
import { requireWorkspaceTrust } from './workspace-trust'
import { renameThread } from './rename-thread'
import { knownCodexExecutables, LinuxWriterRecovery } from './linux-writer-recovery'
import { recoverWriterAndTrash } from './writer-recovery'

const CONFIGURATION = 'threadbox'
const REFRESH_SIDEBAR_COMMAND = 'threadbox.refreshSidebar'
const SEARCH_SIDEBAR_COMMAND = 'threadbox.searchSidebar'
const CLEAR_SEARCH_COMMAND = 'threadbox.clearSidebarSearch'
const SIDEBAR_VIEW = 'threadbox.sidebar'
const CODEX_PRIMARY_SIDEBAR_VIEW = 'threadbox.sidebar.codexPrimary'
const CODEX_SECONDARY_SIDEBAR_VIEW = 'threadbox.sidebar.codexSecondary'
const CODEX_EXTENSION_ID = 'openai.chatgpt'
const RESPONSIVE_LIST_OPTIONS: ThreadListOptions = {
  allowPartial: true,
  refreshEnvironment: false,
  requestTimeoutMs: 5_000,
  useStateDbOnly: true
}
const SIDEBAR_COMMANDS = {
  newProject: 'threadbox.newProject',
  importWorkspace: 'threadbox.importCurrentWorkspaceProject',
  newThread: 'threadbox.newThreadInProject',
  renameProject: 'threadbox.renameProject',
  renameThread: 'threadbox.renameThread',
  deleteProject: 'threadbox.deleteProject',
  moveToProject: 'threadbox.moveToProject',
  archive: 'threadbox.archive',
  unarchive: 'threadbox.unarchive',
  pin: 'threadbox.pin',
  unpin: 'threadbox.unpin',
  delete: 'threadbox.delete',
  restoreFromTrash: 'threadbox.restoreFromTrash',
  emptyTrash: 'threadbox.emptyTrash',
  updateCodexCli: 'threadbox.updateCodexCli',
  copyId: 'threadbox.copyId',
  openDirectory: 'threadbox.openDirectory',
  openInCodex: 'threadbox.openInCodex',
  openOnDoubleClick: 'threadbox.openInCodexOnDoubleClick'
} as const

function selectedItems(primary?: SidebarItem, selection?: SidebarItem[]): SidebarItem[] {
  if (primary && selection?.length && !selection.includes(primary)) return [primary]
  if (selection && selection.length > 0) return selection
  return primary ? [primary] : []
}

function commandThreadId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  return value instanceof SidebarItem ? value.thread?.id ?? null : null
}

async function openThreadInCodex(threadId: string): Promise<void> {
  requireWorkspaceTrust(vscode.workspace.isTrusted)
  const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID)
  if (!extension) throw new Error('The Codex extension is not installed on this extension host.')
  const activationEvents = (extension.packageJSON as { activationEvents?: unknown }).activationEvents
  if (!Array.isArray(activationEvents) || !activationEvents.includes('onUri')) {
    await vscode.commands.executeCommand('chatgpt.openSidebar')
    throw new Error('This Codex extension version cannot navigate to a task in its sidebar.')
  }
  const deepLink = vscode.Uri.from({
    scheme: vscode.env.uriScheme,
    authority: CODEX_EXTENSION_ID,
    path: `/local/${threadId}`
  })
  if (!await vscode.env.openExternal(deepLink)) {
    throw new Error('VS Code could not open this task in the Codex sidebar.')
  }
}

function configuredString(name: string): string | null {
  const value = vscode.workspace.getConfiguration(CONFIGURATION).get<unknown>(name)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function configuredLocale(): AppLocale {
  const value = configuredString('language')
  if (value === 'en' || value === 'zh-CN') return value
  return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function openRemoteTerminal(command: string, title: string): void {
  const terminal = vscode.window.createTerminal({ name: title, isTransient: true })
  terminal.show(false)
  terminal.sendText(command, true)
}

class RuntimeHost implements vscode.Disposable {
  private runtime: CodexRuntime | null = null
  private client: AppServerClient | null = null
  private service: ThreadService | null = null
  private environment: NodeJS.ProcessEnv | null = null
  private readonly updater = new CodexCliUpdater()
  private updatePromise: Promise<EnvironmentStatus> | null = null

  constructor(private readonly version: string) {}

  getRuntime(): CodexRuntime {
    if (this.runtime) return this.runtime
    const environment = { ...process.env }
    const codexHome = configuredString('codexHome')
    if (codexHome) environment.CODEX_HOME = resolve(codexHome)
    this.environment = environment
    this.runtime = new CodexRuntime({
      load: async () => ({ customCliPath: configuredString('codexBinary') })
    }, environment)
    return this.runtime
  }

  getService(): ThreadService {
    if (this.service) return this.service
    this.service = new ThreadService(this.getClient())
    return this.service
  }

  getClient(): AppServerClient {
    if (this.client) return this.client
    this.client = this.createClient()
    return this.client
  }

  createOneShotClient(): AppServerClient {
    return this.createClient()
  }

  getCodexHome(): string {
    this.getRuntime()
    return resolve(this.environment?.CODEX_HOME || join(homedir(), '.codex'))
  }

  private createClient(): AppServerClient {
    return new AppServerClient(this.getRuntime(), {
      name: 'codex_threadbox_vscode',
      title: 'Threadbox for Codex VS Code',
      version: this.version,
      initializeCapabilities: { experimentalApi: true, requestAttestation: false }
    })
  }

  updateCodexCli(): Promise<EnvironmentStatus> {
    if (this.updatePromise) return this.updatePromise
    const pending = this.performCodexCliUpdate()
    const tracked = pending.finally(() => {
      if (this.updatePromise === tracked) this.updatePromise = null
    })
    this.updatePromise = tracked
    return tracked
  }

  private async performCodexCliUpdate(): Promise<EnvironmentStatus> {
    const runtime = this.getRuntime()
    const before = await runtime.probe(true)
    if (before.status.state === 'ready') {
      throw new Error(`Codex CLI ${before.status.cliVersion ?? ''} already satisfies the minimum version.`)
    }
    if (before.status.state === 'missing') {
      return this.installUserLevelCodex(null)
    }
    if (before.status.state !== 'outdated') {
      throw new Error(before.status.message ?? 'Codex CLI is not available for installation or update.')
    }

    this.client?.stop()
    this.client = null
    this.service = null
    try {
      await this.updater.update(before.command, this.environment ?? process.env)
    } catch (error) {
      if (!(error instanceof CodexCliPermissionError)) throw error
      const locale = configuredLocale()
      const sudoLabel = locale === 'zh-CN' ? '使用 sudo 更新' : 'Update with sudo'
      const userLabel = locale === 'zh-CN' ? '改为用户级安装' : 'Install for current user'
      const message = locale === 'zh-CN'
        ? process.platform === 'win32'
          ? '当前 Codex CLI 没有权限更新。可以用管理员终端更新原安装，或者改为仅当前用户可用的独立安装。'
          : '当前 Codex CLI 安装在系统目录，普通用户没有权限更新。建议使用 sudo 更新原安装，只保留一套 Codex；共享服务器也可以改为仅当前用户可用的独立安装。'
        : process.platform === 'win32'
          ? 'The current Codex CLI cannot be updated without administrator permission. Update the existing installation from an Administrator terminal, or install a standalone copy for only this user.'
          : 'The current Codex CLI is installed in a system directory and cannot be updated without permission. Use sudo to update the existing installation and keep one Codex, or install a standalone copy for only this user on a shared server.'
      const choice = process.platform === 'win32'
        ? await vscode.window.showWarningMessage(message, { modal: true }, userLabel)
        : await vscode.window.showWarningMessage(message, { modal: true }, sudoLabel, userLabel)
      if (choice === sudoLabel) {
        openRemoteTerminal(
          SUDO_NPM_UPDATE_COMMAND,
          locale === 'zh-CN' ? 'Threadbox：更新 Codex CLI' : 'Threadbox: Update Codex CLI'
        )
        throw new Error(locale === 'zh-CN'
          ? '已在当前远端的集成终端运行 sudo 更新命令。请输入 sudo 密码；命令完成后点击“重试”。'
          : 'The sudo update command is running in the current remote terminal. Enter your sudo password, then click Retry after it completes.',
        { cause: error })
      }
      if (choice === userLabel) return this.installUserLevelCodex(before.command)
      throw new Error(
        locale === 'zh-CN' ? 'Codex CLI 更新已取消。' : 'Codex CLI update was cancelled.',
        { cause: error }
      )
    }
    runtime.invalidate()
    const after = await runtime.probe(true)
    if (after.status.state !== 'ready') {
      throw new Error(
        `Codex CLI update completed, but the installed version is still not usable. ${after.status.message ?? ''}`
          .trim()
      )
    }
    return after.status
  }

  private async installUserLevelCodex(conflictingNpmPath: string | null): Promise<EnvironmentStatus> {
    const previousPath = configuredString('codexBinary')
    const environment = this.environment ?? process.env
    this.client?.stop()
    this.client = null
    this.service = null
    const installed = await this.updater.installStandalone(environment)
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION)
    await configuration.update(
      'codexBinary',
      installed.path,
      vscode.ConfigurationTarget.Global
    )
    this.resetRuntimeState()
    const after = await this.getRuntime().probe(true)
    if (after.status.state !== 'ready') {
      await configuration.update(
        'codexBinary',
        previousPath ?? '',
        vscode.ConfigurationTarget.Global
      )
      this.resetRuntimeState()
      throw new Error(
        `Codex CLI installation completed, but ${installed.path} is not usable. ${after.status.message ?? ''}`
          .trim()
      )
    }
    if (conflictingNpmPath) await this.offerSystemNpmCleanup(conflictingNpmPath)
    return after.status
  }

  private async offerSystemNpmCleanup(conflictingPath: string): Promise<void> {
    const locale = configuredLocale()
    const cleanupLabel = locale === 'zh-CN' ? '卸载旧的系统版本' : 'Uninstall old system version'
    const choice = await vscode.window.showWarningMessage(
      locale === 'zh-CN'
        ? `用户级 Codex 已安装并验证。旧的系统级 npm 版本仍在 ${conflictingPath}；建议现在卸载，避免 PATH 冲突。卸载需要管理员权限，并可能影响共享服务器上的其他账号。`
        : `The user-level Codex installation is ready. The old system npm installation is still at ${conflictingPath}; uninstall it now to avoid PATH conflicts. Administrator permission is required, and removal may affect other accounts on a shared server.`,
      { modal: true },
      cleanupLabel
    )
    if (choice !== cleanupLabel) return
    openRemoteTerminal(
      process.platform === 'win32' ? NPM_UNINSTALL_COMMAND : SUDO_NPM_UNINSTALL_COMMAND,
      locale === 'zh-CN' ? 'Threadbox：清理旧 Codex CLI' : 'Threadbox: Remove old Codex CLI'
    )
    void vscode.window.showInformationMessage(locale === 'zh-CN'
      ? process.platform === 'win32'
        ? '已在当前扩展宿主的集成终端运行卸载命令；如权限不足，请在管理员终端执行。Threadbox 已固定使用用户级 Codex。'
        : '已在当前远端的集成终端运行卸载命令。请输入 sudo 密码完成清理。Threadbox 已固定使用用户级 Codex。'
      : process.platform === 'win32'
        ? 'The uninstall command is running in the current extension host terminal. If permission is denied, run it from an Administrator terminal. Threadbox is already using the user-level Codex.'
        : 'The uninstall command is running in the current remote terminal. Enter your sudo password to finish cleanup. Threadbox is already using the user-level Codex.')
  }

  private resetRuntimeState(): void {
    this.client?.stop()
    this.runtime = null
    this.client = null
    this.service = null
    this.environment = null
  }

  reset(): void {
    this.updater.stop()
    this.resetRuntimeState()
    this.updatePromise = null
  }

  dispose(): void {
    this.reset()
  }
}

function unavailableRecents(): DesktopRecentsRepairResult {
  return {
    removed: 0,
    backupPath: null,
    status: { state: 'unavailable', staleCount: 0, staleEntries: [], message: null }
  }
}

function platformCapabilities(): PlatformCapabilities {
  const currentWorkspaceDirectories = workspaceDirectories()
  return {
    host: 'vscode',
    projectManagement: true,
    desktopRecentsRepair: false,
    directoryTrash: false,
    chooseCliPath: false,
    openWorkingDirectory: true,
    currentWorkspaceDirectories,
    projectThreadCreation: true,
    threadRenaming: true,
    taskTrash: true,
    workspaceProjectImport: currentWorkspaceDirectories.length > 0,
    codexCliUpdate: true
  }
}

function workspaceDirectories(): string[] {
  return [...new Set(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
  )]
}

function directoryUri(path: string): vscode.Uri {
  const remoteBase = (vscode.workspace.workspaceFolders ?? []).find(
    (folder) => folder.uri.scheme !== 'file'
  )?.uri
  return remoteBase ? remoteBase.with({ path }) : vscode.Uri.file(path)
}

async function serviceWithProjectThreads(
  runtime: RuntimeHost,
  projects: ProjectStore
): Promise<ThreadService> {
  const service = runtime.getService()
  service.setSupplementalThreadReferences(await projects.inventoryReferences())
  return service
}

function createApi(runtime: RuntimeHost, projects: ProjectStore): ThreadboxApi {
  const trash = (): TrashController => new TrashController(runtime.getService(), projects)
  return {
    getPlatformCapabilities: async () => platformCapabilities(),
    getEnvironmentStatus: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return (await runtime.getRuntime().probe(true)).status
    },
    updateCodexCli: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.updateCodexCli()
    },
    listThreads: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const result = await (await serviceWithProjectThreads(runtime, projects))
        .listThreads(RESPONSIVE_LIST_OPTIONS)
      await projects.setInventory(result.threads, {
        persistPruning: result.inventory.state === 'complete'
      })
      return result
    },
    renameThread: async (id, name) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await renameThread(runtime.getClient(), id, name, () => requireWorkspaceTrust(vscode.workspace.isTrusted))
    },
    deleteThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return trash().trash(ids)
    },
    trashThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return trash().trash(ids)
    },
    restoreThreadsFromTrash: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return trash().restore(ids)
    },
    emptyTrash: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return trash().empty()
    },
    repairDesktopRecents: async () => unavailableRecents(),
    archiveThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return (await serviceWithProjectThreads(runtime, projects)).archiveThreads(ids)
    },
    unarchiveThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return (await serviceWithProjectThreads(runtime, projects)).unarchiveThreads(ids)
    },
    setPinned: async (ids, pinned) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return (await serviceWithProjectThreads(runtime, projects)).setPinned(ids, pinned)
    },
    listProjects: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return projects.list()
    },
    createProject: async (name) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return projects.create(name)
    },
    importCurrentWorkspaceProject: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const locale = configuredLocale()
      const roots = workspaceDirectories()
      if (roots.length === 0) {
        void vscode.window.showWarningMessage(locale === 'zh-CN'
          ? '当前窗口没有打开的工作区。'
          : 'No workspace is open in the current window.')
        return null
      }
      const result = await (await serviceWithProjectThreads(runtime, projects)).listThreads()
      await projects.setInventory(result.threads, { persistPruning: false })
      const preview = await projects.previewWorkspaceImport(roots)
      if (preview.rootIds.length === 0) {
        void vscode.window.showWarningMessage(locale === 'zh-CN'
          ? '当前工作区中没有可导入的 Codex 对话。垃圾箱中的对话不会被移动。'
          : 'No eligible Codex tasks were found in this workspace. Tasks in Trash are not moved.')
        return null
      }
      if (preview.existingProject) {
        void vscode.window.showInformationMessage(locale === 'zh-CN'
          ? `当前工作区已经导入到项目“${preview.existingProject.name}”。`
          : `This workspace is already imported as "${preview.existingProject.name}".`)
        return projects.list()
      }
      const defaultName = vscode.workspace.name?.trim() || basename(roots[0]!) || roots[0]!
      const name = await vscode.window.showInputBox({
        prompt: locale === 'zh-CN' ? '导入当前工作区' : 'Import current workspace',
        placeHolder: locale === 'zh-CN' ? '项目名称' : 'Project name',
        value: defaultName,
        valueSelection: [0, defaultName.length],
        validateInput: (value) => {
          const normalized = value.trim()
          if (!normalized || normalized.length > 80 ||
            [...normalized].some((character) => character.charCodeAt(0) < 32)) {
            return locale === 'zh-CN' ? '请输入 1-80 个可见字符。' : 'Enter 1-80 visible characters.'
          }
          return null
        }
      })
      if (!name?.trim()) return null
      const imported = await projects.importWorkspace(name, roots)
      const project = imported.snapshot.projects.find((item) => item.id === imported.projectId)
      void vscode.window.showInformationMessage(locale === 'zh-CN'
        ? `已导入 ${imported.importedRootCount} 个对话到项目“${project?.name ?? name.trim()}”。`
        : `Imported ${imported.importedRootCount} tasks into "${project?.name ?? name.trim()}".`)
      return imported.snapshot
    },
    renameProject: async (id, name) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return projects.renameProject(id, name)
    },
    deleteProject: async (id) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return projects.deleteProject(id)
    },
    assignThreads: async (ids, projectId) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return trash().assign(ids, projectId)
    },
    createThreadInProject: async (projectId, name) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const project = await projects.getProject(projectId)
      if (!project) throw new Error('Project not found.')
      if (!project.canCreateThread) {
        throw new Error(project.createThreadUnavailableReason ??
          'Tasks cannot be created in this project.')
      }
      const cwd = await chooseProjectDirectory(project, {
        pickRoot: async (roots) => {
          const choice = await vscode.window.showQuickPick(
            roots.map((root) => ({ label: basename(root) || root, description: root, root })),
            { placeHolder: configuredLocale() === 'zh-CN' ? '选择工作目录' : 'Choose a working directory' }
          )
          return choice?.root ?? null
        },
        pickFolder: async () => {
          const selected = await vscode.window.showOpenDialog({
            title: configuredLocale() === 'zh-CN' ? '选择工作目录' : 'Choose a working directory',
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: configuredLocale() === 'zh-CN' ? '选择' : 'Select'
          })
          return selected?.[0]?.fsPath ?? null
        }
      })
      if (!cwd) return null
      const client = runtime.createOneShotClient()
      try {
        return await createProjectThread(
          client,
          project,
          name,
          cwd,
          (threadId, targetProjectId) => projects.assignCreatedThread(threadId, targetProjectId)
        )
      } finally {
        client.stop()
      }
    },
    openWorkingDirectory: async (path) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await vscode.commands.executeCommand('vscode.openFolder', directoryUri(path), true)
      return null
    },
    copyThreadId: async (id) => vscode.env.clipboard.writeText(id),
    chooseCliPath: async () => null,
    getSettings: async () => ({
      locale: configuredLocale(),
      customCliPath: configuredString('codexBinary')
    }),
    updateSettings: async (patch) => {
      const configuration = vscode.workspace.getConfiguration(CONFIGURATION)
      if (patch.locale !== undefined) {
        await configuration.update('language', patch.locale, vscode.ConfigurationTarget.Global)
      }
      if (patch.customCliPath !== undefined) {
        await configuration.update(
          'codexBinary',
          patch.customCliPath ?? '',
          vscode.ConfigurationTarget.Global
        )
      }
      runtime.reset()
      return {
        locale: patch.locale ?? configuredLocale(),
        customCliPath: patch.customCliPath === undefined
          ? configuredString('codexBinary')
          : patch.customCliPath
      } satisfies AppSettings
    }
  }
}



export interface ThreadboxExtensionApi {
  getThreadboxApi(): ThreadboxApi
}

export async function activate(context: vscode.ExtensionContext): Promise<ThreadboxExtensionApi> {
  const version = String(context.extension.packageJSON.version ?? '0.10.1')
  const runtime = new RuntimeHost(version)
  await migrateLegacyProjectStorage(context.globalStorageUri.fsPath)
  const projects = new ProjectStore(join(context.globalStorageUri.fsPath, 'projects-v1.json'))
  const api = createApi(runtime, projects)
  let recoveryDisposed = false
  let recoveryPending = false
  context.subscriptions.push({ dispose: () => { recoveryDisposed = true } })
  const recover = async (ids: string[]): Promise<BatchOperationResult | null> => {
    if (recoveryPending) throw new Error('Another writer recovery is already in progress.')
    const initialConfiguration = [configuredString('codexHome'), configuredString('codexBinary')]
    const guard = (): void => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      if (recoveryDisposed || initialConfiguration[0] !== configuredString('codexHome') ||
        initialConfiguration[1] !== configuredString('codexBinary')) {
        throw new Error('The extension or Codex configuration changed. Start recovery again.')
      }
    }
    guard()
    recoveryPending = true
    try {
      const probe = await runtime.getRuntime().probe()
      if (probe.status.state !== 'ready') throw new Error(probe.status.message ?? 'Codex CLI is unavailable.')
      const allowed = await knownCodexExecutables(probe.command,
        vscode.extensions.getExtension(CODEX_EXTENSION_ID)?.extensionUri.fsPath)
      const backend = new LinuxWriterRecovery(join(context.extensionUri.fsPath, 'dist', 'writer-recovery.py'),
        runtime.getCodexHome(), allowed, guard)
      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: configuredLocale() === 'zh-CN' ? '正在检查 Codex 占用并重试…' : 'Checking Codex ownership and retrying…',
        cancellable: false
      }, () => recoverWriterAndTrash(ids, {
        backend, guard,
        trash: (targets) => new TrashController(runtime.getService(), projects).trash(targets),
        inventory: async () => (await (await serviceWithProjectThreads(runtime, projects)).listThreads()).threads,
        preview: async (targets) => (await serviceWithProjectThreads(runtime, projects)).previewDeleteThreads(targets),
        confirm: async (owner, threads, force) => {
          guard()
          const chinese = configuredLocale() === 'zh-CN'
          const titles = new Map(threads.map((thread) => [thread.id, thread.title]))
          const affected = owner.locks.map((lock) => (titles.get(lock.id) ?? 'Unknown task') + ' [' + lock.id + ']')
          const action = chinese ? force ? '强制结束后台' : '结束后台并重试' : force ? 'Force Stop Backend' : 'Stop Backend and Retry'
          const message = chinese
            ? force ? 'Codex 后台未退出。是否强制结束？未完成的工作可能丢失。' : '结束占用的 Codex 后台并重试移入垃圾箱？'
            : force ? 'Codex did not release the task. Force stop it? Unfinished work may be lost.' : 'Stop the occupying Codex backend and retry Move to Trash?'
          const detail = (chinese
            ? '这会断开该后台管理的全部会话，正在运行的任务也可能被中断，之后可能需要重载 Codex。以下仅是能识别到的占用，不保证包含全部后台活动。不会直接删除任何会话或锁文件。'
            : 'This disconnects ALL sessions served by this backend and may interrupt running tasks. Codex may need reloading afterwards. Known writer locks below may not cover all backend activity. No session or lock files will be directly deleted.') +
            '\n\nPID: ' + owner.pid + '\n' + owner.executable + '\n\n' + affected.join('\n')
          const selected = await vscode.window.showWarningMessage(message, { modal: true, detail }, action)
          guard()
          return selected === action
        }
      }))
    } finally { recoveryPending = false }
  }
  const sidebar = new ThreadboxSidebarProvider(
    api,
    SIDEBAR_COMMANDS.openOnDoubleClick,
    SIDEBAR_COMMANDS.updateCodexCli,
    configuredLocale(),
    process.platform === 'linux' ? recover : undefined,
    {
      load: () => context.workspaceState.get('threadbox.sidebarView'),
      save: (options) => context.workspaceState.update('threadbox.sidebarView', options),
      directories: workspaceDirectories
    }
  )
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { sidebar.clearSelection(); sidebar.refresh() }))
  const doubleClickGate = new DoubleClickGate()
  const codexExtension = vscode.extensions.getExtension(CODEX_EXTENSION_ID)
  const codexContainers = findKnownCodexViewContainers(codexExtension?.packageJSON)
  await vscode.commands.executeCommand(
    'setContext',
    'threadbox.codexContainerAvailable',
    codexContainers.length > 0
  )
  const viewIds = [SIDEBAR_VIEW]
  if (codexContainers.includes(CODEX_PRIMARY_CONTAINER)) viewIds.push(CODEX_PRIMARY_SIDEBAR_VIEW)
  if (codexContainers.includes(CODEX_SECONDARY_CONTAINER)) {
    viewIds.push(CODEX_SECONDARY_SIDEBAR_VIEW)
  }
  const sidebarViews = viewIds.map((viewId) => vscode.window.createTreeView(viewId, {
    treeDataProvider: sidebar,
    dragAndDropController: sidebar,
    canSelectMany: true,
    manageCheckboxStateManually: true,
    showCollapseAll: true
  }))
  context.subscriptions.push(runtime, sidebar, ...sidebarViews)
  for (const view of sidebarViews) context.subscriptions.push(
    view.onDidChangeCheckboxState((event) => sidebar.checkItems(event.items))
  )
  context.subscriptions.push(sidebar.onDidChangeSummary((summary) => {
    for (const view of sidebarViews) {
      view.badge = summary.taskCount > 0
        ? { value: summary.taskCount, tooltip: summary.tooltip }
        : undefined
    }
  }))
  context.subscriptions.push(sidebar.onDidChangeSearch((query) => {
    for (const view of sidebarViews) view.description = query || undefined
    void vscode.commands.executeCommand('setContext', 'threadbox.searchActive', query.length > 0)
  }))
  void vscode.commands.executeCommand('setContext', 'threadbox.searchActive', false)
  void vscode.commands.executeCommand('setContext', 'threadbox.multiSelectMode', false)
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('threadbox.codexBinary') ||
      event.affectsConfiguration('threadbox.codexHome')) runtime.reset()
    if (event.affectsConfiguration(CONFIGURATION)) sidebar.setLocale(configuredLocale())
  }))
  context.subscriptions.push(vscode.commands.registerCommand(REFRESH_SIDEBAR_COMMAND, () => {
    sidebar.refresh()
  }))
  context.subscriptions.push(
    vscode.commands.registerCommand('threadbox.filterSidebar', () => sidebar.filter()),
    vscode.commands.registerCommand('threadbox.toggleMultiSelect', () => sidebar.toggleMultiSelect()),
    vscode.commands.registerCommand('threadbox.sortSidebar', () => sidebar.sort()),
    vscode.commands.registerCommand('threadbox.resetFilters', () => sidebar.resetFilters()),
    vscode.commands.registerCommand('threadbox.selectFiltered', () => sidebar.selectFiltered()),
    vscode.commands.registerCommand('threadbox.clearSelection', () => sidebar.clearSelection()),
    vscode.commands.registerCommand('threadbox.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:irisNeko.codex-threadbox-vscode')),
    vscode.commands.registerCommand('threadbox.trashSelected', () => sidebar.deleteThreads([])),
    vscode.commands.registerCommand('threadbox.archiveSelected', () => sidebar.archiveThreads([], true)),
    vscode.commands.registerCommand('threadbox.unarchiveSelected', () => sidebar.archiveThreads([], false)),
    vscode.commands.registerCommand('threadbox.restoreSelected', () => sidebar.restoreThreads([])),
    vscode.commands.registerCommand('threadbox.moveSelected', () => sidebar.moveThreads([])),
    vscode.commands.registerCommand(SEARCH_SIDEBAR_COMMAND, () => sidebar.search()),
    vscode.commands.registerCommand(CLEAR_SEARCH_COMMAND, () => sidebar.clearSearch())
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.newProject, () => sidebar.createProject()),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.importWorkspace,
      () => sidebar.importCurrentWorkspace()),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.newThread,
      (item?: SidebarItem) => sidebar.createThread(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.renameProject,
      (item?: SidebarItem) => sidebar.renameProject(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.renameThread,
      (item?: SidebarItem) => sidebar.renameThread(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.deleteProject,
      (item?: SidebarItem) => sidebar.deleteProject(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.moveToProject,
      (item?: SidebarItem, selection?: SidebarItem[]) => sidebar.moveThreads(selectedItems(item, selection))),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.archive,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.archiveThreads(selectedItems(item, selection), true)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.unarchive,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.archiveThreads(selectedItems(item, selection), false)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.pin,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.pinThreads(selectedItems(item, selection), true)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.unpin,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.pinThreads(selectedItems(item, selection), false)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.delete,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.deleteThreads(selectedItems(item, selection))),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.restoreFromTrash,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.restoreThreads(selectedItems(item, selection))),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.emptyTrash,
      (item?: SidebarItem) => sidebar.emptyTrash(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.updateCodexCli,
      () => sidebar.updateCodexCli()),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.copyId,
      (item?: SidebarItem, selection?: SidebarItem[]) =>
        sidebar.copyIds(selectedItems(item, selection))),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.openDirectory,
      (item?: SidebarItem) => sidebar.openDirectory(item)),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.openInCodex, async (value?: unknown) => {
      const threadId = commandThreadId(value)
      if (!threadId) return
      try { await openThreadInCodex(threadId) }
      catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      }
    }),
    vscode.commands.registerCommand(SIDEBAR_COMMANDS.openOnDoubleClick, async (value?: unknown) => {
      const threadId = commandThreadId(value)
      if (!threadId || !doubleClickGate.register(threadId)) return
      await vscode.commands.executeCommand(SIDEBAR_COMMANDS.openInCodex, threadId)
    })
  )

  return { getThreadboxApi: () => api }
}

export function deactivate(): void {}
