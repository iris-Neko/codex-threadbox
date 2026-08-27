import { randomBytes } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
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
import { CodexCliUpdater } from './codex-update'
import { parseRpcRequest, type RpcRequest, type RpcResponse } from './rpc'
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

const CONFIGURATION = 'threadbox'
const COMMAND = 'threadbox.openManager'
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
  if (selection && selection.length > 0) return selection
  return primary ? [primary] : []
}

function commandThreadId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  return value instanceof SidebarItem ? value.thread?.id ?? null : null
}

async function openThreadInCodex(threadId: string): Promise<void> {
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
    this.client = new AppServerClient(this.getRuntime(), {
      name: 'codex_threadbox_vscode',
      title: 'Threadbox for Codex VS Code',
      version: this.version
    })
    return this.client
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
    if (before.status.state !== 'outdated') {
      if (before.status.state === 'ready') {
        throw new Error(`Codex CLI ${before.status.cliVersion ?? ''} already satisfies the minimum version.`)
      }
      throw new Error(before.status.message ?? 'Codex CLI is not available for self-update.')
    }

    this.client?.stop()
    this.client = null
    this.service = null
    await this.updater.update(before.command, this.environment ?? process.env)
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

  reset(): void {
    this.updater.stop()
    this.client?.stop()
    this.runtime = null
    this.client = null
    this.service = null
    this.environment = null
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
      return createProjectThread(
        runtime.getClient(),
        project,
        name,
        cwd,
        (threadId, targetProjectId) => projects.assignCreatedThread(threadId, targetProjectId)
      )
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

async function dispatch(api: ThreadboxApi, request: RpcRequest): Promise<unknown> {
  const method = api[request.method] as (...args: never[]) => Promise<unknown>
  return method(...request.args as never[])
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(24).toString('base64')
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>Threadbox for Codex</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}

function attachRpc(
  panel: vscode.WebviewPanel,
  api: ThreadboxApi,
  onMutation: () => void
): vscode.Disposable {
  return panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const request = parseRpcRequest(message)
    if (!request) return
    let response: RpcResponse
    try {
      response = { kind: 'threadbox.response', id: request.id, ok: true, value: await dispatch(api, request) }
      if (['deleteThreads', 'trashThreads', 'restoreThreadsFromTrash', 'emptyTrash',
        'archiveThreads', 'unarchiveThreads', 'setPinned', 'updateSettings',
        'createProject', 'importCurrentWorkspaceProject', 'renameProject', 'deleteProject', 'assignThreads',
        'createThreadInProject', 'updateCodexCli']
        .includes(request.method)) onMutation()
    } catch (error) {
      response = {
        kind: 'threadbox.response',
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    await panel.webview.postMessage(response)
  })
}

export interface ThreadboxExtensionApi {
  getThreadboxApi(): ThreadboxApi
}

export async function activate(context: vscode.ExtensionContext): Promise<ThreadboxExtensionApi> {
  const version = String(context.extension.packageJSON.version ?? '0.8.0')
  const runtime = new RuntimeHost(version)
  await migrateLegacyProjectStorage(context.globalStorageUri.fsPath)
  const projects = new ProjectStore(join(context.globalStorageUri.fsPath, 'projects-v1.json'))
  const api = createApi(runtime, projects)
  const sidebar = new ThreadboxSidebarProvider(
    api,
    SIDEBAR_COMMANDS.openOnDoubleClick,
    SIDEBAR_COMMANDS.updateCodexCli,
    vscode.env.language
  )
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
    showCollapseAll: true
  }))
  let panel: vscode.WebviewPanel | null = null
  context.subscriptions.push(runtime, sidebar, ...sidebarViews)
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
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('threadbox.codexBinary') ||
      event.affectsConfiguration('threadbox.codexHome')) runtime.reset()
    if (event.affectsConfiguration(CONFIGURATION)) sidebar.refresh()
  }))
  context.subscriptions.push(vscode.commands.registerCommand(REFRESH_SIDEBAR_COMMAND, () => {
    sidebar.refresh()
  }))
  context.subscriptions.push(
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
  context.subscriptions.push(vscode.commands.registerCommand(COMMAND, () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One)
      return
    }
    panel = vscode.window.createWebviewPanel(
      'threadbox.manager',
      'Threadbox for Codex',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
      }
    )
    panel.webview.html = webviewHtml(panel.webview, context.extensionUri)
    const rpc = attachRpc(panel, api, () => sidebar.refresh())
    panel.onDidDispose(() => {
      rpc.dispose()
      panel = null
    })
    sidebar.refresh()
  }))
  return { getThreadboxApi: () => api }
}

export function deactivate(): void {}
