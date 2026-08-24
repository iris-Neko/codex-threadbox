import { basename } from 'node:path'
import * as vscode from 'vscode'
import type {
  EnvironmentStatus,
  ProjectRecord,
  ProjectSnapshot,
  ThreadboxApi,
  ThreadRecord
} from '../../../src/shared/contracts'
import { groupThreads } from '../../core/src/thread-utils'

const SETTINGS_COMMAND = 'workbench.action.openSettings'
const TREE_MIME = 'application/vnd.code.tree.threadbox.sidebar'

interface SidebarLabels {
  openManager: string
  settings: string
  ready: string
  projects: string
  unassigned: string
  archived: string
  workspaceTrust: string
  unavailable: string
  newProject: string
  projectName: string
  renameProject: string
  deleteProject: string
  deleteProjectConfirm: string
  moveToProject: string
  removeFromProject: string
  deleteTasksConfirm: string
  deleteTasks: string
  noEligibleTasks: string
  officialProject: string
  threadboxProject: string
}

function labels(locale: string): SidebarLabels {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      openManager: '打开 Threadbox 管理器', settings: '打开设置', ready: '就绪', projects: '项目',
      unassigned: '未归属', archived: '已归档', workspaceTrust: '需要信任工作区才能读取 Codex 任务',
      unavailable: 'Codex CLI 不可用', newProject: '新建项目', projectName: '项目名称',
      renameProject: '重命名项目', deleteProject: '删除项目',
      deleteProjectConfirm: '只删除项目分组，任务会变为未归属。', moveToProject: '移动到项目',
      removeFromProject: '移出 Threadbox 项目', deleteTasksConfirm: '任务记录将永久删除，工作目录会保留。',
      deleteTasks: '永久删除', noEligibleTasks: '所选任务正在运行或已置顶，不能删除。',
      officialProject: 'Codex 项目', threadboxProject: 'Threadbox 项目'
    }
  }
  return {
    openManager: 'Open Threadbox Manager', settings: 'Open Settings', ready: 'Ready', projects: 'Projects',
    unassigned: 'Unassigned', archived: 'Archived', workspaceTrust: 'Trust this workspace to read Codex tasks',
    unavailable: 'Codex CLI unavailable', newProject: 'New project', projectName: 'Project name',
    renameProject: 'Rename project', deleteProject: 'Delete project',
    deleteProjectConfirm: 'Only the project grouping will be deleted. Tasks will become unassigned.',
    moveToProject: 'Move to project', removeFromProject: 'Remove from Threadbox project',
    deleteTasksConfirm: 'Task records will be permanently deleted. Working directories will be kept.',
    deleteTasks: 'Delete permanently',
    noEligibleTasks: 'The selected tasks are running or pinned and cannot be deleted.',
    officialProject: 'Codex project', threadboxProject: 'Threadbox project'
  }
}

export type SidebarItemKind = 'action' | 'status' | 'section' | 'project' | 'directory' |
  'archive' | 'thread' | 'unassigned'

interface SidebarItemOptions {
  kind: SidebarItemKind
  description?: string
  icon?: string
  command?: vscode.Command
  tooltip?: string
  children?: SidebarItem[]
  contextValue?: string
  project?: ProjectRecord
  thread?: ThreadRecord
}

export class SidebarItem extends vscode.TreeItem {
  readonly kind: SidebarItemKind
  readonly children?: SidebarItem[]
  readonly project?: ProjectRecord
  readonly thread?: ThreadRecord

  constructor(label: string, options: SidebarItemOptions) {
    super(label, options.children && options.children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None)
    this.kind = options.kind
    this.description = options.description
    this.iconPath = options.icon ? new vscode.ThemeIcon(options.icon) : undefined
    this.command = options.command
    this.tooltip = options.tooltip
    this.children = options.children
    this.contextValue = options.contextValue
    this.project = options.project
    this.thread = options.thread
  }
}

export interface SidebarSummary { taskCount: number; tooltip: string }

export class ThreadboxSidebarProvider implements
vscode.TreeDataProvider<SidebarItem>, vscode.TreeDragAndDropController<SidebarItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined>()
  private readonly summaryChanged = new vscode.EventEmitter<SidebarSummary>()
  private cached: Promise<SidebarItem[]> | null = null
  private snapshot: ProjectSnapshot = { projects: [], assignments: {}, refreshedAt: 0 }

  readonly onDidChangeTreeData = this.changed.event
  readonly onDidChangeSummary = this.summaryChanged.event
  readonly dragMimeTypes = [TREE_MIME]
  readonly dropMimeTypes = [TREE_MIME]

  constructor(
    private readonly api: ThreadboxApi,
    private readonly openManagerCommand: string,
    private readonly locale: string
  ) {}

  refresh(): void { this.cached = null; this.changed.fire(undefined) }
  getTreeItem(element: SidebarItem): vscode.TreeItem { return element }
  getChildren(element?: SidebarItem): Promise<SidebarItem[]> | SidebarItem[] {
    if (element) return element.children ?? []
    this.cached ??= this.loadRootItems()
    return this.cached
  }
  dispose(): void { this.changed.dispose(); this.summaryChanged.dispose() }

  async handleDrag(source: readonly SidebarItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const ids = source.flatMap((item) => item.thread ? [item.thread.id] : [])
    if (ids.length > 0) dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(JSON.stringify(ids)))
  }

  async handleDrop(target: SidebarItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(TREE_MIME)
    if (!item || !target || (target.kind !== 'project' && target.kind !== 'unassigned') ||
      target.project?.readOnly) return
    try {
      const value: unknown = JSON.parse(await item.asString())
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return
      this.snapshot = await this.api.assignThreads(value, target.project?.id ?? null)
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async createProject(): Promise<void> {
    const copy = labels(this.locale)
    const name = await vscode.window.showInputBox({ prompt: copy.newProject, placeHolder: copy.projectName })
    if (!name?.trim()) return
    try { this.snapshot = await this.api.createProject(name); this.refresh() }
    catch (error) { await this.showError(error) }
  }

  async renameProject(item?: SidebarItem): Promise<void> {
    const project = item?.project
    if (!project || project.readOnly) return
    const copy = labels(this.locale)
    const name = await vscode.window.showInputBox({
      prompt: copy.renameProject, value: project.name, valueSelection: [0, project.name.length]
    })
    if (!name?.trim() || name.trim() === project.name) return
    try { this.snapshot = await this.api.renameProject(project.id, name); this.refresh() }
    catch (error) { await this.showError(error) }
  }

  async deleteProject(item?: SidebarItem): Promise<void> {
    const project = item?.project
    if (!project || project.readOnly) return
    const copy = labels(this.locale)
    const confirmed = await vscode.window.showWarningMessage(
      `${copy.deleteProjectConfirm}\n\n${project.name}`, { modal: true }, copy.deleteProject)
    if (confirmed !== copy.deleteProject) return
    try { this.snapshot = await this.api.deleteProject(project.id); this.refresh() }
    catch (error) { await this.showError(error) }
  }

  async moveThreads(items: readonly SidebarItem[]): Promise<void> {
    const ids = this.threadIds(items)
    if (ids.length === 0) return
    const copy = labels(this.locale)
    const custom = this.snapshot.projects.filter((project) => project.kind === 'threadbox')
    const choice = await vscode.window.showQuickPick([
      { label: copy.removeFromProject, id: null as string | null },
      ...custom.map((project) => ({ label: project.name, description: copy.threadboxProject,
        id: project.id as string | null }))
    ], { placeHolder: copy.moveToProject })
    if (!choice) return
    try { this.snapshot = await this.api.assignThreads(ids, choice.id); this.refresh() }
    catch (error) { await this.showError(error) }
  }

  async archiveThreads(items: readonly SidebarItem[], archived: boolean): Promise<void> {
    const threads = items.flatMap((item) => item.thread ? [item.thread] : [])
      .filter((thread) => thread.status !== 'active' && thread.archived !== archived)
    if (threads.length === 0) return
    try {
      if (archived) await this.api.archiveThreads(threads.map((thread) => thread.id))
      else await this.api.unarchiveThreads(threads.map((thread) => thread.id))
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async pinThreads(items: readonly SidebarItem[], pinned: boolean): Promise<void> {
    const threads = items.flatMap((item) => item.thread ? [item.thread] : [])
      .filter((thread) => thread.status !== 'active' && thread.pinned !== pinned)
    if (threads.length === 0) return
    try { await this.api.setPinned(threads.map((thread) => thread.id), pinned); this.refresh() }
    catch (error) { await this.showError(error) }
  }

  async deleteThreads(items: readonly SidebarItem[]): Promise<void> {
    const copy = labels(this.locale)
    const ids = items.flatMap((item) => item.thread ? [item.thread] : [])
      .filter((thread) => thread.status !== 'active' && !thread.pinned).map((thread) => thread.id)
    if (ids.length === 0) { await vscode.window.showWarningMessage(copy.noEligibleTasks); return }
    const confirmed = await vscode.window.showWarningMessage(
      `${copy.deleteTasksConfirm}\n\n${ids.length}`, { modal: true }, copy.deleteTasks)
    if (confirmed !== copy.deleteTasks) return
    try {
      const result = await this.api.deleteThreads(ids, { trashWorkingDirectories: [] })
      if (result.failed.length > 0 || result.skipped.length > 0) {
        await vscode.window.showWarningMessage(
          `${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped.`)
      }
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async copyIds(items: readonly SidebarItem[]): Promise<void> {
    const ids = this.threadIds(items)
    if (ids.length > 0) await vscode.env.clipboard.writeText(ids.join('\n'))
  }

  async openDirectory(item?: SidebarItem): Promise<void> {
    if (!item?.thread) return
    const message = await this.api.openWorkingDirectory(item.thread.cwd)
    if (message) await vscode.window.showWarningMessage(message)
  }

  private threadIds(items: readonly SidebarItem[]): string[] {
    return [...new Set(items.flatMap((item) => item.thread ? [item.thread.id] : []))]
  }
  private command(title: string): vscode.Command { return { command: this.openManagerCommand, title } }
  private settingsCommand(title: string): vscode.Command {
    return { command: SETTINGS_COMMAND, title, arguments: ['@ext:irisNeko.threadbox-for-codex'] }
  }

  private environmentItems(status: EnvironmentStatus, copy: SidebarLabels): SidebarItem[] {
    const version = status.cliVersion ? `Codex ${status.cliVersion}` : copy.unavailable
    return [new SidebarItem(version, {
      kind: 'status', description: status.state === 'ready' ? copy.ready : status.message ?? status.state,
      icon: status.state === 'ready' ? 'pass-filled' : 'warning',
      command: status.state === 'ready' ? undefined : this.settingsCommand(copy.settings),
      tooltip: status.message ?? version
    })]
  }

  private threadItems(threads: ThreadRecord[]): SidebarItem[] {
    const byParent = new Map<string, ThreadRecord[]>()
    const ids = new Set(threads.map((thread) => thread.id))
    const roots: ThreadRecord[] = []
    for (const thread of threads) {
      if (thread.parentThreadId && ids.has(thread.parentThreadId)) {
        const children = byParent.get(thread.parentThreadId) ?? []
        children.push(thread); byParent.set(thread.parentThreadId, children)
      } else roots.push(thread)
    }
    const visit = (thread: ThreadRecord): SidebarItem => {
      const children = (byParent.get(thread.id) ?? []).map(visit)
      const archive = thread.archived ? 'archived' : 'active'
      const pin = thread.pinned ? 'pinned' : 'unpinned'
      return new SidebarItem(thread.title, {
        kind: 'thread', description: basename(thread.cwd),
        icon: thread.status === 'active' ? 'sync~spin' : thread.pinned ? 'pinned' : 'comment-discussion',
        command: this.command(thread.title), tooltip: `${thread.title}\n${thread.cwd}`,
        children: children.length > 0 ? children : undefined,
        contextValue: `threadbox.thread.${archive}.${pin}`, thread
      })
    }
    return roots.toSorted((left, right) => right.updatedAt - left.updatedAt).map(visit)
  }

  private projectChildren(threads: ThreadRecord[], copy: SidebarLabels): SidebarItem[] {
    const active = threads.filter((thread) => !thread.archived)
    const archived = threads.filter((thread) => thread.archived)
    const children = this.threadItems(active)
    if (archived.length > 0) children.push(new SidebarItem(copy.archived, {
      kind: 'archive', description: String(archived.filter((thread) => !thread.internal).length),
      icon: 'archive', children: this.threadItems(archived)
    }))
    return children
  }

  private async loadRootItems(): Promise<SidebarItem[]> {
    const copy = labels(this.locale)
    const open = new SidebarItem(copy.openManager, {
      kind: 'action', icon: 'open-preview', command: this.command(copy.openManager)
    })
    if (!vscode.workspace.isTrusted) {
      this.summaryChanged.fire({ taskCount: 0, tooltip: copy.workspaceTrust })
      return [open, new SidebarItem(copy.workspaceTrust, { kind: 'status', icon: 'shield', tooltip: copy.workspaceTrust })]
    }
    let status: EnvironmentStatus
    try { status = await this.api.getEnvironmentStatus() }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [open, new SidebarItem(copy.unavailable, { kind: 'status', description: message, icon: 'error',
        command: this.settingsCommand(copy.settings), tooltip: message })]
    }
    if (status.state !== 'ready') {
      this.summaryChanged.fire({ taskCount: 0, tooltip: status.message ?? copy.unavailable })
      return [open, ...this.environmentItems(status, copy), new SidebarItem(copy.settings, {
        kind: 'action', icon: 'settings-gear', command: this.settingsCommand(copy.settings)
      })]
    }
    try {
      const result = await this.api.listThreads()
      this.snapshot = await this.api.listProjects()
      const main = result.threads.filter((thread) => !thread.internal)
      const groups = groupThreads(result.threads, this.snapshot, 'projects')
      const customProjects = this.snapshot.projects.filter((project) => project.kind === 'threadbox')
      const projectItems: SidebarItem[] = customProjects.map((project) => {
        const group = groups.find((item) => item.kind === 'threadboxProject' && item.projectId === project.id)
        const threads = group?.threads ?? []
        return new SidebarItem(project.name, { kind: 'project',
          description: String(threads.filter((thread) => !thread.internal && !thread.archived).length),
          icon: 'folder-library', tooltip: copy.threadboxProject, children: this.projectChildren(threads, copy),
          contextValue: 'threadbox.project.threadbox', project })
      })
      for (const group of groups.filter((item) => item.kind === 'desktopProject')) {
        const project = group.project ?? { id: group.projectId ?? group.id, name: group.name,
          kind: 'official' as const, readOnly: true, createdAt: null, updatedAt: null }
        projectItems.push(new SidebarItem(group.name, { kind: 'project',
          description: String(group.threads.filter((thread) => !thread.internal && !thread.archived).length),
          icon: 'folder-library', tooltip: copy.officialProject, children: this.projectChildren(group.threads, copy),
          contextValue: 'threadbox.project.official', project }))
      }
      const unassignedGroups = groups.filter((group) =>
        group.kind === 'localWorkspace' || group.kind === 'standalone')
      const unassignedChildren = unassignedGroups.map((group) => new SidebarItem(group.name || copy.unassigned, {
        kind: 'directory',
        description: String(group.threads.filter((thread) => !thread.internal && !thread.archived).length),
        icon: 'folder', tooltip: group.directories.join('\n'), children: this.projectChildren(group.threads, copy)
      }))
      projectItems.push(new SidebarItem(copy.unassigned, { kind: 'unassigned',
        description: String(unassignedGroups.flatMap((group) => group.threads)
          .filter((thread) => !thread.internal && !thread.archived).length),
        icon: 'inbox', children: unassignedChildren, contextValue: 'threadbox.project.unassigned' }))
      const activeCount = main.filter((thread) => !thread.archived).length
      this.summaryChanged.fire({ taskCount: activeCount, tooltip: `${activeCount} tasks` })
      return [open, ...this.environmentItems(result.environment, copy), new SidebarItem(copy.projects, {
        kind: 'section', description: String(customProjects.length), icon: 'project', children: projectItems,
        contextValue: 'threadbox.projects'
      })]
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [open, ...this.environmentItems(status, copy), new SidebarItem(copy.unavailable, {
        kind: 'status', description: message, icon: 'error', tooltip: message
      })]
    }
  }

  private async showError(error: unknown): Promise<void> {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}
