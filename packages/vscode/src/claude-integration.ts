import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { claudeConfigDirectory, claudePathKey, sameClaudeWorkspace, type ClaudeHistoryReader, type ClaudeSession } from './claude-history'
import { LocalClaudeHistoryReader } from './claude-history-reader'
import { ClaudeResumeStore } from './claude-resume'
import { ClaudeHistorySidebar } from './claude-sidebar'
import { DoubleClickGate } from './double-click'

const CLAUDE_EXTENSION = 'anthropic.claude-code'
const OPEN_COMMAND = 'claude-vscode.editor.open'
const enabled = (): boolean => vscode.workspace.getConfiguration('threadbox').get('claudeHistoryEnabled', true)
const directories = (): string[] => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
function configDir(useOverride = true): string {
  return claudeConfigDirectory(
    useOverride ? vscode.workspace.getConfiguration('threadbox').get('claudeConfigDir') : undefined,
    vscode.workspace.getConfiguration('claudeCode').get('environmentVariables'), process.env
  )
}
function guard(): void {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before browsing or opening Claude Code history.')
  if (!enabled()) throw new Error('Claude Code history is disabled in Threadbox settings.')
}

/** Injectable coordinator so cancellation, trust and window handoff are testable. */
export interface ClaudeOpenHost {
  guard(): void
  configDir(): string
  folders(): string[]
  ensureExtension(): Promise<void>
  confirm(cwd: string): Promise<boolean>
  openWindow(cwd: string): Promise<void>
  resume(id: string, cwd: string, home: string): Promise<void>
}

export async function openClaudeSession(
  session: ClaudeSession, home: string, reader: ClaudeHistoryReader,
  store: ClaudeResumeStore, host: ClaudeOpenHost
): Promise<void> {
  host.guard()
  const verifyHome = (): void => {
    host.guard()
    if (claudePathKey(home) !== claudePathKey(host.configDir())) {
      throw new Error('Threadbox and Claude Code use different config directories. Match their settings before resuming.')
    }
  }
  verifyHome()
  if (!session.cwd) throw new Error('This conversation has no recorded working directory and cannot be resumed automatically.')
  const current = await reader.get(home, session.id, session.cwd)
  verifyHome()
  if (!current?.cwd || current.id !== session.id || claudePathKey(current.cwd) !== claudePathKey(session.cwd)) {
    throw new Error('This Claude conversation was removed or moved. Refresh history before opening it.')
  }
  if (!(await stat(session.cwd).catch(() => null))?.isDirectory()) {
    throw new Error('The original Claude working directory no longer exists on this host. Its history is still listed.')
  }
  await host.ensureExtension()
  verifyHome()
  if (sameClaudeWorkspace(session.cwd, host.folders())) {
    await host.resume(session.id, session.cwd, home)
    return
  }
  if (!await host.confirm(session.cwd)) return
  verifyHome()
  const cancel = await store.enqueue(current, home)
  try {
    verifyHome()
    await host.openWindow(session.cwd)
  } catch (error) { await cancel(); throw error }
}

export function registerClaudeHistory(context: vscode.ExtensionContext, locale: () => string): void {
  const reader = new LocalClaudeHistoryReader(join(context.extensionUri.fsPath, 'dist', 'claude-history-worker.mjs'))
  const store = new ClaudeResumeStore(join(context.globalStorageUri.fsPath, 'claude-resume'))
  const host: ClaudeOpenHost = {
    guard,
    configDir: () => configDir(false),
    folders: directories,
    ensureExtension: async () => {
      guard()
      const extension = vscode.extensions.getExtension(CLAUDE_EXTENSION)
      if (!extension) throw new Error(locale().startsWith('zh')
        ? '请先在当前主机安装官方 Claude Code 扩展（Anthropic），然后重试。'
        : 'Install the official Claude Code extension (Anthropic) on this host, then try again.')
      const manifest = extension.packageJSON as { contributes?: { commands?: Array<{ command?: string }> } }
      if (!manifest.contributes?.commands?.some((command) => command.command === OPEN_COMMAND)) {
        throw new Error('Update the Claude Code extension: this version does not expose conversation navigation.')
      }
      // Avoid launching another extension while merely confirming a window switch.
    },
    confirm: async (cwd) => {
      const chinese = locale().startsWith('zh')
      const action = chinese ? '打开原目录并继续' : 'Open Original Folder and Resume'
      return await vscode.window.showInformationMessage(chinese
        ? '此对话属于另一个文件夹。Claude Code 需要在原目录中恢复，将新开一个 VS Code 窗口；当前窗口保留。'
        : 'Claude Code must resume this conversation in its original folder. Open a new VS Code window? The current window stays open.',
      { modal: true, detail: cwd }, action) === action
    },
    openWindow: async (cwd) => {
      guard()
      const remote = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme !== 'file')?.uri
        ?? (context.globalStorageUri.scheme !== 'file' ? context.globalStorageUri : undefined)
      if (vscode.env.remoteName && !remote) throw new Error('Cannot determine this remote host. Open the original folder on this host manually.')
      const remotePath = cwd.replaceAll('\\', '/')
      const uri = remote ? remote.with({ path: remotePath.startsWith('/') ? remotePath : '/' + remotePath, query: '', fragment: '' }) : vscode.Uri.file(cwd)
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })
    },
    resume: async (id, cwd, home) => {
      guard()
      const extension = vscode.extensions.getExtension(CLAUDE_EXTENSION)
      if (!extension) throw new Error('Claude Code extension is unavailable.')
      await extension.activate()
      guard()
      if (!sameClaudeWorkspace(cwd, directories()) || claudePathKey(home) !== claudePathKey(configDir(false))) {
        throw new Error('Workspace or Claude settings changed while opening the extension. Try again.')
      }
      // No initial prompt, model call, permission-mode override or arbitrary arguments.
      await vscode.commands.executeCommand(OPEN_COMMAND, id)
    }
  }
  const sidebar = new ClaudeHistorySidebar(reader, {
    guard, configDir, locale, open: (session, home) => openClaudeSession(session, home, reader, store, host)
  })
  const view = vscode.window.createTreeView('threadbox.claudeHistory', { treeDataProvider: sidebar, showCollapseAll: true })
  const gate = new DoubleClickGate()
  const safely = async (operation: () => Promise<unknown>): Promise<void> => {
    try { await operation() } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Claude Code history is unavailable.')
    }
  }
  context.subscriptions.push(reader, sidebar, view,
    vscode.commands.registerCommand('threadbox.claudeRefresh', () => sidebar.refresh()),
    vscode.commands.registerCommand('threadbox.claudeSearch', () => sidebar.search()),
    vscode.commands.registerCommand('threadbox.claudeClearSearch', () => sidebar.clearSearch()),
    vscode.commands.registerCommand('threadbox.claudeOpen', (value: unknown) => safely(() => sidebar.open(value))),
    vscode.commands.registerCommand('threadbox.claudeCopyId', (value: unknown) => safely(() => sidebar.copyId(value))),
    vscode.commands.registerCommand('threadbox.claudeOpenOnDoubleClick', (value: unknown) => {
      if (typeof value === 'string' && gate.register(value)) return safely(() => sidebar.open(value))
      return undefined
    })
  )
  let watcher: vscode.FileSystemWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const watch = (): void => {
    watcher?.dispose()
    clearTimeout(timer)
    sidebar.refresh()
    if (!enabled() || !vscode.workspace.isTrusted || disposed) return
    try {
      watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(configDir(), 'projects/**/*.jsonl'))
      const update = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => { if (!disposed) sidebar.refresh() }, 1500)
      }
      watcher.onDidCreate(update)
      watcher.onDidChange(update)
      watcher.onDidDelete(update)
    } catch { /* The view reports invalid config paths without breaking Codex. */ }
  }
  const pendingResume = async (): Promise<void> => {
    if (!enabled() || !vscode.workspace.isTrusted || disposed) return
    const request = await store.take(directories(), configDir())
    if (!request || disposed) return
    await openClaudeSession({ id: request.sessionId, title: '', cwd: request.cwd, updatedAt: 0, createdAt: null },
      request.configDir, reader, store, host)
  }
  context.subscriptions.push(
    { dispose: () => { disposed = true; watcher?.dispose(); clearTimeout(timer) } },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('threadbox') || event.affectsConfiguration('claudeCode.environmentVariables')) watch()
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { watch(); void safely(pendingResume) }),
    vscode.window.onDidChangeWindowState((state) => { if (state.focused) sidebar.refresh() })
  )
  watch()
  void safely(pendingResume)
}
