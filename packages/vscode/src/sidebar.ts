import { basename } from 'node:path'
import * as vscode from 'vscode'
import type {
  EnvironmentStatus,
  ThreadboxApi,
  ThreadRecord
} from '../../../src/shared/contracts'

const SETTINGS_COMMAND = 'workbench.action.openSettings'

interface SidebarLabels {
  openManager: string
  settings: string
  ready: string
  activeTasks: string
  archivedTasks: string
  currentWorkspace: string
  recentTasks: string
  workspaceTrust: string
  unavailable: string
}

function labels(locale: string): SidebarLabels {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      openManager: '打开 Threadbox 管理器',
      settings: '打开设置',
      ready: '就绪',
      activeTasks: '主任务',
      archivedTasks: '已归档',
      currentWorkspace: '当前工作区',
      recentTasks: '最近任务',
      workspaceTrust: '需要信任工作区才能读取 Codex 任务',
      unavailable: 'Codex CLI 不可用'
    }
  }
  return {
    openManager: 'Open Threadbox Manager',
    settings: 'Open Settings',
    ready: 'Ready',
    activeTasks: 'Main tasks',
    archivedTasks: 'Archived',
    currentWorkspace: 'Current workspace',
    recentTasks: 'Recent tasks',
    workspaceTrust: 'Trust this workspace to read Codex tasks',
    unavailable: 'Codex CLI unavailable'
  }
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function belongsToWorkspace(thread: ThreadRecord, directories: readonly string[]): boolean {
  const cwd = normalizedPath(thread.cwd)
  return directories.some((directory) => {
    const root = normalizedPath(directory)
    return cwd === root || cwd.startsWith(`${root}/`)
  })
}

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    options: {
      description?: string
      icon?: string
      command?: vscode.Command
      tooltip?: string
      children?: SidebarItem[]
    } = {}
  ) {
    super(
      label,
      options.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    )
    this.description = options.description
    this.iconPath = options.icon ? new vscode.ThemeIcon(options.icon) : undefined
    this.command = options.command
    this.tooltip = options.tooltip
    this.children = options.children
  }

  readonly children?: SidebarItem[]
}

export interface SidebarSummary {
  taskCount: number
  tooltip: string
}

export class ThreadboxSidebarProvider implements vscode.TreeDataProvider<SidebarItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined>()
  private readonly summaryChanged = new vscode.EventEmitter<SidebarSummary>()
  private cached: Promise<SidebarItem[]> | null = null

  readonly onDidChangeTreeData = this.changed.event
  readonly onDidChangeSummary = this.summaryChanged.event

  constructor(
    private readonly api: ThreadboxApi,
    private readonly openManagerCommand: string,
    private readonly locale: string
  ) {}

  refresh(): void {
    this.cached = null
    this.changed.fire(undefined)
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: SidebarItem): Promise<SidebarItem[]> | SidebarItem[] {
    if (element) return element.children ?? []
    this.cached ??= this.loadRootItems()
    return this.cached
  }

  dispose(): void {
    this.changed.dispose()
    this.summaryChanged.dispose()
  }

  private command(title: string): vscode.Command {
    return { command: this.openManagerCommand, title }
  }

  private settingsCommand(title: string): vscode.Command {
    return {
      command: SETTINGS_COMMAND,
      title,
      arguments: ['@ext:irisNeko.threadbox-for-codex']
    }
  }

  private environmentItems(status: EnvironmentStatus, copy: SidebarLabels): SidebarItem[] {
    const version = status.cliVersion ? `Codex ${status.cliVersion}` : copy.unavailable
    const description = status.state === 'ready' ? copy.ready : status.message ?? status.state
    return [
      new SidebarItem(version, {
        description,
        icon: status.state === 'ready' ? 'pass-filled' : 'warning',
        command: status.state === 'ready' ? undefined : this.settingsCommand(copy.settings),
        tooltip: status.message ?? version
      })
    ]
  }

  private async loadRootItems(): Promise<SidebarItem[]> {
    const copy = labels(this.locale)
    const open = new SidebarItem(copy.openManager, {
      icon: 'open-preview',
      command: this.command(copy.openManager)
    })

    if (!vscode.workspace.isTrusted) {
      this.summaryChanged.fire({ taskCount: 0, tooltip: copy.workspaceTrust })
      return [
        open,
        new SidebarItem(copy.workspaceTrust, { icon: 'shield', tooltip: copy.workspaceTrust })
      ]
    }

    let status: EnvironmentStatus
    try {
      status = await this.api.getEnvironmentStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [open, new SidebarItem(copy.unavailable, {
        description: message,
        icon: 'error',
        command: this.settingsCommand(copy.settings),
        tooltip: message
      })]
    }

    if (status.state !== 'ready') {
      this.summaryChanged.fire({ taskCount: 0, tooltip: status.message ?? copy.unavailable })
      return [open, ...this.environmentItems(status, copy), new SidebarItem(copy.settings, {
        icon: 'settings-gear',
        command: this.settingsCommand(copy.settings)
      })]
    }

    try {
      const [result, capabilities] = await Promise.all([
        this.api.listThreads(),
        this.api.getPlatformCapabilities()
      ])
      const main = result.threads.filter((thread) => !thread.internal)
      const active = main.filter((thread) => !thread.archived)
      const archived = main.filter((thread) => thread.archived)
      const workspace = active.filter((thread) =>
        belongsToWorkspace(thread, capabilities.currentWorkspaceDirectories)
      )
      const recent = active.slice(0, 8).map((thread) => new SidebarItem(thread.title, {
        description: basename(thread.cwd),
        icon: thread.status === 'active' ? 'sync~spin' : thread.pinned ? 'pinned' : 'comment-discussion',
        command: this.command(copy.openManager),
        tooltip: `${thread.title}\n${thread.cwd}`
      }))

      this.summaryChanged.fire({
        taskCount: active.length,
        tooltip: `${active.length} ${copy.activeTasks}`
      })
      return [
        open,
        ...this.environmentItems(result.environment, copy),
        new SidebarItem(copy.activeTasks, {
          description: String(active.length),
          icon: 'inbox',
          command: this.command(copy.openManager)
        }),
        new SidebarItem(copy.currentWorkspace, {
          description: String(workspace.length),
          icon: 'folder-library',
          command: this.command(copy.openManager)
        }),
        new SidebarItem(copy.archivedTasks, {
          description: String(archived.length),
          icon: 'archive',
          command: this.command(copy.openManager)
        }),
        ...(recent.length > 0
          ? [new SidebarItem(copy.recentTasks, { icon: 'history', children: recent })]
          : [])
      ]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [
        open,
        ...this.environmentItems(status, copy),
        new SidebarItem(message, { icon: 'error', tooltip: message })
      ]
    }
  }
}
