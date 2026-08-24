import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import * as vscode from 'vscode'
import { AppServerClient, CodexRuntime, ThreadService } from '../../core/src/index'
import type {
  AppLocale,
  AppSettings,
  DesktopRecentsRepairResult,
  PlatformCapabilities,
  ThreadboxApi
} from '../../../src/shared/contracts'
import { parseRpcRequest, type RpcRequest, type RpcResponse } from './rpc'
import { ThreadboxSidebarProvider } from './sidebar'
import { requireWorkspaceTrust } from './workspace-trust'

const CONFIGURATION = 'threadbox'
const COMMAND = 'threadbox.openManager'
const REFRESH_SIDEBAR_COMMAND = 'threadbox.refreshSidebar'
const SIDEBAR_VIEW = 'threadbox.sidebar'

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

  getRuntime(): CodexRuntime {
    if (this.runtime) return this.runtime
    const environment = { ...process.env }
    const codexHome = configuredString('codexHome')
    if (codexHome) environment.CODEX_HOME = resolve(codexHome)
    this.runtime = new CodexRuntime({
      load: async () => ({ customCliPath: configuredString('codexBinary') })
    }, environment)
    return this.runtime
  }

  getService(): ThreadService {
    if (this.service) return this.service
    this.client = new AppServerClient(this.getRuntime(), {
      name: 'codex_threadbox_vscode',
      title: 'Threadbox for Codex VS Code',
      version: '0.3.0'
    })
    this.service = new ThreadService(this.client)
    return this.service
  }

  reset(): void {
    this.client?.stop()
    this.runtime = null
    this.client = null
    this.service = null
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
  const currentWorkspaceDirectories = [...new Set(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
  )]
  return {
    host: 'vscode',
    desktopRecentsRepair: false,
    directoryTrash: false,
    chooseCliPath: false,
    openWorkingDirectory: true,
    currentWorkspaceDirectories
  }
}

function directoryUri(path: string): vscode.Uri {
  const remoteBase = (vscode.workspace.workspaceFolders ?? []).find(
    (folder) => folder.uri.scheme !== 'file'
  )?.uri
  return remoteBase ? remoteBase.with({ path }) : vscode.Uri.file(path)
}

function createApi(runtime: RuntimeHost): ThreadboxApi {
  return {
    getPlatformCapabilities: async () => platformCapabilities(),
    getEnvironmentStatus: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return (await runtime.getRuntime().probe(true)).status
    },
    listThreads: async () => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.getService().listThreads()
    },
    deleteThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.getService().deleteThreads(ids, { trashWorkingDirectories: [] })
    },
    repairDesktopRecents: async () => unavailableRecents(),
    archiveThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.getService().archiveThreads(ids)
    },
    unarchiveThreads: async (ids) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.getService().unarchiveThreads(ids)
    },
    setPinned: async (ids, pinned) => {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      return runtime.getService().setPinned(ids, pinned)
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
      if (['deleteThreads', 'archiveThreads', 'unarchiveThreads', 'setPinned', 'updateSettings']
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

export function activate(context: vscode.ExtensionContext): ThreadboxExtensionApi {
  const runtime = new RuntimeHost()
  const api = createApi(runtime)
  const sidebar = new ThreadboxSidebarProvider(api, COMMAND, vscode.env.language)
  const sidebarView = vscode.window.createTreeView(SIDEBAR_VIEW, {
    treeDataProvider: sidebar,
    showCollapseAll: false
  })
  let panel: vscode.WebviewPanel | null = null
  context.subscriptions.push(runtime, sidebar, sidebarView)
  context.subscriptions.push(sidebar.onDidChangeSummary((summary) => {
    sidebarView.badge = summary.taskCount > 0
      ? { value: summary.taskCount, tooltip: summary.tooltip }
      : undefined
  }))
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('threadbox.codexBinary') ||
      event.affectsConfiguration('threadbox.codexHome')) runtime.reset()
    if (event.affectsConfiguration(CONFIGURATION)) sidebar.refresh()
  }))
  context.subscriptions.push(vscode.commands.registerCommand(REFRESH_SIDEBAR_COMMAND, () => {
    sidebar.refresh()
  }))
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
