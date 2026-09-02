import { basename } from 'node:path'
import * as vscode from 'vscode'
import type {
  EnvironmentStatus,
  ListThreadsResult,
  ProjectRecord,
  ProjectSnapshot,
  ThreadboxApi,
  ThreadRecord
} from '../../../src/shared/contracts'
import { groupThreads } from '../../core/src/thread-utils'
import {
  actionableRootIds,
  buildVisibleThreadHierarchy,
  collectThreadIds,
  filterSidebarThreads,
  manualMoveTargets,
  selectedRootIds,
  type ThreadHierarchyNode
} from './sidebar-selection'

const SETTINGS_COMMAND = 'workbench.action.openSettings'
const TREE_MIME = 'application/vnd.code.tree.threadbox.sidebar'

interface SidebarLabels {
  settings: string
  ready: string
  projects: string
  unassigned: string
  archived: string
  workspaceTrust: string
  unavailable: string
  loadFailed: string
  partialInventory: string
  installCodexCli: string
  installingCodexCli: string
  codexCliInstalled: string
  updateCodexCli: string
  updatingCodexCli: string
  codexCliUpdated: string
  newProject: string
  newThread: string
  threadName: string
  threadCreated: string
  projectName: string
  renameProject: string
  deleteProject: string
  deleteProjectConfirm: string
  moveToProject: string
  removeFromProject: string
  trash: string
  moveToTrashConfirm: string
  moveToTrash: string
  restoreFromTrash: string
  emptyTrash: string
  emptyTrashConfirm: string
  noEligibleTasks: string
  search: string
  searchPlaceholder: string
  noResults: string
  createAndMove: string
}

function labels(locale: string): SidebarLabels {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      settings: '打开设置', ready: '就绪', projects: '项目',
      unassigned: '未归属', archived: '已归档', workspaceTrust: '需要信任工作区才能读取 Codex 任务',
      unavailable: 'Codex CLI 不可用', loadFailed: '任务列表载入失败',
      partialInventory: '部分任务未载入', newProject: '新建项目', projectName: '项目名称',
      installCodexCli: '安装 Codex CLI', installingCodexCli: '正在安装 Codex CLI…',
      codexCliInstalled: 'Codex CLI 已安装',
      updateCodexCli: '更新 Codex CLI', updatingCodexCli: '正在更新 Codex CLI…',
      codexCliUpdated: 'Codex CLI 已更新',
      newThread: '新建对话', threadName: '对话名称', threadCreated: '已创建对话',
      renameProject: '重命名项目', deleteProject: '删除项目',
      deleteProjectConfirm: '只删除项目分组，任务会变为未归属。', moveToProject: '移动到项目',
      removeFromProject: '移出 Threadbox 项目', trash: '垃圾箱',
      moveToTrashConfirm: '任务会移入垃圾箱并归档，工作目录会保留。', moveToTrash: '移入垃圾箱',
      restoreFromTrash: '从垃圾箱恢复', emptyTrash: '清空垃圾箱',
      emptyTrashConfirm: '垃圾箱中的任务记录将永久删除，工作目录会保留。',
      noEligibleTasks: '所选任务正在运行、已置顶或已经在垃圾箱中。',
      search: '搜索任务',
      searchPlaceholder: '标题、摘要、目录、来源、ID 或项目', noResults: '没有匹配的任务',
      createAndMove: '新建项目并移动'
    }
  }
  return {
    settings: 'Open Settings', ready: 'Ready', projects: 'Projects',
    unassigned: 'Unassigned', archived: 'Archived', workspaceTrust: 'Trust this workspace to read Codex tasks',
    unavailable: 'Codex CLI unavailable', loadFailed: 'Task list failed to load',
    partialInventory: 'Some tasks were not loaded', newProject: 'New project', projectName: 'Project name',
    installCodexCli: 'Install Codex CLI', installingCodexCli: 'Installing Codex CLI…',
    codexCliInstalled: 'Codex CLI installed',
    updateCodexCli: 'Update Codex CLI', updatingCodexCli: 'Updating Codex CLI…',
    codexCliUpdated: 'Codex CLI updated',
    newThread: 'New task', threadName: 'Task name', threadCreated: 'Task created',
    renameProject: 'Rename project', deleteProject: 'Delete project',
    deleteProjectConfirm: 'Only the project grouping will be deleted. Tasks will become unassigned.',
    moveToProject: 'Move to project', removeFromProject: 'Remove from Threadbox project',
    trash: 'Trash', moveToTrashConfirm: 'Tasks will be archived and moved to Trash. Working directories will be kept.',
    moveToTrash: 'Move to Trash', restoreFromTrash: 'Restore from Trash', emptyTrash: 'Empty Trash',
    emptyTrashConfirm: 'Task records in Trash will be permanently deleted. Working directories will be kept.',
    noEligibleTasks: 'The selected tasks are running, pinned, or already in Trash.',
    search: 'Search tasks',
    searchPlaceholder: 'Title, preview, directory, source, ID, or project', noResults: 'No matching tasks',
    createAndMove: 'Create project and move'
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
  id?: string
  selectionIds?: string[]
}

export class SidebarItem extends vscode.TreeItem {
  readonly kind: SidebarItemKind
  readonly children?: SidebarItem[]
  readonly project?: ProjectRecord
  readonly thread?: ThreadRecord
  readonly selectionIds?: string[]

  constructor(label: string, options: SidebarItemOptions) {
    super(label, options.children && options.children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None)
    this.kind = options.kind
    this.id = options.id
    this.description = options.description
    this.iconPath = options.icon ? new vscode.ThemeIcon(options.icon) : undefined
    this.command = options.command
    this.tooltip = options.tooltip
    this.children = options.children
    this.contextValue = options.contextValue
    this.project = options.project
    this.thread = options.thread
    this.selectionIds = options.selectionIds
  }
}

export interface SidebarSummary { taskCount: number; tooltip: string }

interface LoadedSidebarData {
  result: ListThreadsResult
  snapshot: ProjectSnapshot
}

export class ThreadboxSidebarProvider implements
vscode.TreeDataProvider<SidebarItem>, vscode.TreeDragAndDropController<SidebarItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<SidebarItem | undefined>()
  private readonly summaryChanged = new vscode.EventEmitter<SidebarSummary>()
  private readonly searchChanged = new vscode.EventEmitter<string>()
  private cached: Promise<SidebarItem[]> | null = null
  private loaded: LoadedSidebarData | null = null
  private snapshot: ProjectSnapshot = { projects: [], assignments: {}, refreshedAt: 0 }
  private searchQuery = ''

  readonly onDidChangeTreeData = this.changed.event
  readonly onDidChangeSummary = this.summaryChanged.event
  readonly onDidChangeSearch = this.searchChanged.event
  readonly dragMimeTypes = [TREE_MIME]
  readonly dropMimeTypes = [TREE_MIME]

  constructor(
    private readonly api: ThreadboxApi,
    private readonly openThreadCommand: string,
    private readonly updateCodexCliCommand: string,
    private readonly locale: string
  ) {}

  refresh(): void { this.loaded = null; this.redraw() }

  private async refreshNow(): Promise<void> {
    this.loaded = null
    this.cached = this.loadRootItems()
    await this.cached
    this.changed.fire(undefined)
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem { return element }
  getChildren(element?: SidebarItem): Promise<SidebarItem[]> | SidebarItem[] {
    if (element) return element.children ?? []
    this.cached ??= this.loadRootItems()
    return this.cached
  }
  dispose(): void { this.changed.dispose(); this.summaryChanged.dispose(); this.searchChanged.dispose() }

  async search(): Promise<void> {
    const copy = labels(this.locale)
    const previous = this.searchQuery
    const input = vscode.window.createInputBox()
    let accepted = false
    input.title = copy.search
    input.placeholder = copy.searchPlaceholder
    input.value = previous
    input.onDidChangeValue((value) => this.setSearchQuery(value))
    input.onDidAccept(() => { accepted = true; input.hide() })
    input.onDidHide(() => {
      if (!accepted) this.setSearchQuery(previous)
      input.dispose()
    })
    input.show()
  }

  clearSearch(): void { this.setSearchQuery('') }

  private setSearchQuery(value: string): void {
    if (value === this.searchQuery) return
    this.searchQuery = value
    this.searchChanged.fire(value.trim())
    if (this.loaded) this.redraw()
  }

  private redraw(): void {
    this.cached = null
    this.changed.fire(undefined)
  }

  private updateSnapshot(snapshot: ProjectSnapshot): void {
    this.snapshot = snapshot
    if (this.loaded) this.loaded.snapshot = snapshot
  }

  async handleDrag(source: readonly SidebarItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const ids = this.selectedIds(source)
    if (ids.length > 0) dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(JSON.stringify(ids)))
  }

  async handleDrop(target: SidebarItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(TREE_MIME)
    if (!item || !target || (target.kind !== 'project' && target.kind !== 'unassigned') ||
      (target.kind === 'project' && target.project?.kind !== 'threadbox')) return
    try {
      const value: unknown = JSON.parse(await item.asString())
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return
      const targetProjectId = target.project?.id ?? null
      const ids = this.actionableRootIds(value, targetProjectId)
      if (ids.length === 0) return
      this.updateSnapshot(await this.api.assignThreads(ids, targetProjectId))
      this.redraw()
    } catch (error) { await this.showError(error) }
  }

  async createProject(): Promise<void> {
    const copy = labels(this.locale)
    const name = await vscode.window.showInputBox({ prompt: copy.newProject, placeHolder: copy.projectName })
    if (!name?.trim()) return
    try {
      this.updateSnapshot(await this.api.createProject(name))
      this.redraw()
    }
    catch (error) { await this.showError(error) }
  }

  async importCurrentWorkspace(): Promise<void> {
    if (!this.api.importCurrentWorkspaceProject) return
    try {
      const snapshot = await this.api.importCurrentWorkspaceProject()
      if (!snapshot) return
      this.updateSnapshot(snapshot)
      this.redraw()
    } catch (error) { await this.showError(error) }
  }

  async createThread(item?: SidebarItem): Promise<void> {
    const project = item?.project
    if (!project) return
    if (!project.canCreateThread || !this.api.createThreadInProject) {
      await vscode.window.showWarningMessage(project.createThreadUnavailableReason ??
        'Creating tasks in this project is unavailable.')
      return
    }
    const copy = labels(this.locale)
    const name = await vscode.window.showInputBox({
      prompt: copy.newThread,
      placeHolder: copy.threadName,
      validateInput: (value) => {
        if (!value.trim()) return copy.threadName
        if (value.length > 512 || [...value].some((character) => character.charCodeAt(0) < 32)) {
          return copy.threadName
        }
        return null
      }
    })
    if (!name?.trim()) return
    try {
      const created = await this.api.createThreadInProject(project.id, name)
      if (!created) return
      await this.refreshNow()
      await vscode.window.showInformationMessage(`${copy.threadCreated}: ${created.name}`)
    } catch (error) { await this.showError(error) }
  }

  async renameProject(item?: SidebarItem): Promise<void> {
    const project = item?.project
    if (!project) return
    const copy = labels(this.locale)
    if (project.readOnly) {
      await vscode.window.showWarningMessage(copy.unavailable)
      return
    }
    const name = await vscode.window.showInputBox({
      prompt: copy.renameProject, value: project.name, valueSelection: [0, project.name.length]
    })
    if (!name?.trim() || name.trim() === project.name) return
    try { this.updateSnapshot(await this.api.renameProject(project.id, name)); this.redraw() }
    catch (error) { await this.showError(error) }
  }

  async deleteProject(item?: SidebarItem): Promise<void> {
    const project = item?.project
    if (!project) return
    const copy = labels(this.locale)
    if (project.readOnly) {
      await vscode.window.showWarningMessage(copy.unavailable)
      return
    }
    const confirmed = await vscode.window.showWarningMessage(
      `${copy.deleteProjectConfirm}\n\n${project.name}`, { modal: true }, copy.deleteProject)
    if (confirmed !== copy.deleteProject) return
    try { this.updateSnapshot(await this.api.deleteProject(project.id)); this.redraw() }
    catch (error) { await this.showError(error) }
  }

  async moveThreads(items: readonly SidebarItem[]): Promise<void> {
    const selectedIds = this.selectedIds(items)
    if (selectedIds.length === 0) return
    const copy = labels(this.locale)
    const roots = selectedRootIds(this.loaded?.result.threads ?? [], selectedIds)
    const choices = manualMoveTargets(this.snapshot.projects, this.snapshot.assignments, roots).map((target) => ({
      label: target.kind === 'create'
        ? `$(new-folder) ${copy.createAndMove}`
        : target.kind === 'remove'
          ? copy.removeFromProject
          : this.snapshot.projects.find((project) => project.id === target.projectId)?.systemKind === 'trash'
            ? copy.trash
            : target.name,
      description: undefined,
      target
    }))
    const choice = await vscode.window.showQuickPick(choices, { placeHolder: copy.moveToProject })
    if (!choice) return
    try {
      let projectId = choice.target.kind === 'project' ? choice.target.projectId : null
      if (choice.target.kind === 'create') {
        const name = await vscode.window.showInputBox({ prompt: copy.newProject, placeHolder: copy.projectName })
        if (!name?.trim()) return
        const created = await this.api.createProject(name)
        const project = created.projects.find((item) => item.kind === 'threadbox' &&
          item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
        if (!project) throw new Error('The new Threadbox project could not be found.')
        this.updateSnapshot(created)
        projectId = project.id
      }
      const ids = this.actionableRootIds(roots, projectId)
      if (ids.length === 0) return
      this.updateSnapshot(await this.api.assignThreads(ids, projectId))
      this.redraw()
    }
    catch (error) { await this.showError(error) }
  }

  private actionableRootIds(ids: readonly string[], projectId: string | null): string[] {
    return actionableRootIds(
      this.loaded?.result.threads ?? [],
      this.snapshot.assignments,
      ids,
      projectId
    )
  }

  private selectedIds(items: readonly SidebarItem[]): string[] {
    return [...new Set(items.flatMap((item) => item.selectionIds ?? collectThreadIds([item])))]
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
    const ids = items.flatMap((item) => item.thread ? [item.thread.id] : [])
    if (ids.length === 0) { await vscode.window.showWarningMessage(copy.noEligibleTasks); return }
    const confirmed = await vscode.window.showWarningMessage(
      `${copy.moveToTrashConfirm}\n\n${ids.length}`, { modal: true }, copy.moveToTrash)
    if (confirmed !== copy.moveToTrash) return
    try {
      const result = this.api.trashThreads
        ? await this.api.trashThreads(ids)
        : await this.api.deleteThreads(ids, { trashWorkingDirectories: [] })
      if (result.failed.length > 0 || result.skipped.length > 0) {
        await vscode.window.showWarningMessage(
          `${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped.`)
      }
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async restoreThreads(items: readonly SidebarItem[]): Promise<void> {
    const ids = items.flatMap((item) => item.thread ? [item.thread.id] : [])
    if (ids.length === 0 || !this.api.restoreThreadsFromTrash) return
    try {
      const result = await this.api.restoreThreadsFromTrash(ids)
      if (result.failed.length > 0 || result.skipped.length > 0) {
        await vscode.window.showWarningMessage(
          `${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped.`)
      }
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async emptyTrash(item?: SidebarItem): Promise<void> {
    if (item?.project?.systemKind !== 'trash' || !this.api.emptyTrash) return
    const copy = labels(this.locale)
    const confirmed = await vscode.window.showWarningMessage(
      copy.emptyTrashConfirm, { modal: true }, copy.emptyTrash)
    if (confirmed !== copy.emptyTrash) return
    try {
      const result = await this.api.emptyTrash()
      if (result.failed.length > 0 || result.skipped.length > 0) {
        await vscode.window.showWarningMessage(
          `${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped.`)
      }
      this.refresh()
    } catch (error) { await this.showError(error) }
  }

  async updateCodexCli(): Promise<void> {
    if (!this.api.updateCodexCli) return
    const copy = labels(this.locale)
    try {
      const before = await this.api.getEnvironmentStatus()
      const installing = before.state === 'missing'
      const status = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: installing ? copy.installingCodexCli : copy.updatingCodexCli,
        cancellable: false
      }, () => this.api.updateCodexCli!())
      await vscode.window.showInformationMessage(
        `${installing ? copy.codexCliInstalled : copy.codexCliUpdated}: ${status.cliVersion ?? status.minimumVersion}`
      )
      this.refresh()
    } catch (error) {
      await this.showError(error)
    }
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
  private threadCommand(thread: ThreadRecord): vscode.Command {
    return { command: this.openThreadCommand, title: thread.title, arguments: [thread.id] }
  }
  private settingsCommand(title: string): vscode.Command {
    return { command: SETTINGS_COMMAND, title, arguments: ['@ext:irisNeko.codex-threadbox-vscode'] }
  }

  private environmentItems(status: EnvironmentStatus, copy: SidebarLabels): SidebarItem[] {
    const version = status.cliVersion ? `Codex ${status.cliVersion}` : copy.unavailable
    const items = [new SidebarItem(version, {
      id: 'threadbox:environment',
      kind: 'status', description: status.state === 'ready' ? copy.ready : status.message ?? status.state,
      icon: status.state === 'ready' ? 'pass-filled' : 'warning',
      command: status.state === 'missing' || status.state === 'error'
        ? this.settingsCommand(copy.settings)
        : undefined,
      tooltip: status.message ?? version
    })]
    if ((status.state === 'missing' || status.state === 'outdated') && this.api.updateCodexCli) {
      const title = status.state === 'missing' ? copy.installCodexCli : copy.updateCodexCli
      items.push(new SidebarItem(title, {
        id: 'threadbox:update-codex-cli',
        kind: 'action',
        icon: 'cloud-download',
        command: {
          command: this.updateCodexCliCommand,
          title
        },
        tooltip: status.message ?? title
      }))
    }
    return items
  }

  private threadItems(threads: ThreadRecord[], inTrash = false): SidebarItem[] {
    const visit = (node: ThreadHierarchyNode): SidebarItem => {
      const thread = node.thread
      const children = node.children.map(visit)
      const archive = thread.archived ? 'archived' : 'active'
      const pin = thread.pinned ? 'pinned' : 'unpinned'
      return new SidebarItem(thread.title, {
        id: `threadbox:thread:${thread.id}`,
        kind: 'thread', description: basename(thread.cwd),
        icon: thread.status === 'active' ? 'sync~spin' : thread.pinned ? 'pinned' : 'comment-discussion',
        command: this.threadCommand(thread), tooltip: `${thread.title}\n${thread.cwd}`,
        children: children.length > 0 ? children : undefined,
        contextValue: inTrash
          ? `threadbox.thread.trash.${archive}.${pin}`
          : `threadbox.thread.${archive}.${pin}`,
        thread
      })
    }
    return buildVisibleThreadHierarchy(threads).map(visit)
  }

  private projectChildren(
    threads: ThreadRecord[],
    copy: SidebarLabels,
    ownerId: string,
    allThreads = threads,
    inTrash = false
  ): SidebarItem[] {
    if (inTrash) return this.threadItems(threads, true)
    const active = threads.filter((thread) => !thread.archived)
    const archived = threads.filter((thread) => thread.archived)
    const children = this.threadItems(active)
    if (archived.length > 0) children.push(new SidebarItem(copy.archived, {
      id: `threadbox:archive:${ownerId}`,
      kind: 'archive', description: String(archived.filter((thread) => !thread.internal).length),
      icon: 'archive', children: this.threadItems(archived), contextValue: 'threadbox.group.archive',
      selectionIds: filterSidebarThreads(allThreads.filter((thread) => thread.archived), '')
        .map((thread) => thread.id)
    }))
    return children
  }

  private visibleCount(threads: ThreadRecord[]): number {
    return threads.filter((thread) => !thread.internal &&
      (this.searchQuery.trim().length > 0 || !thread.archived)).length
  }

  private buildLoadedRootItems(data: LoadedSidebarData, copy: SidebarLabels): SidebarItem[] {
    const { result } = data
    this.snapshot = data.snapshot
    const query = this.searchQuery.trim()
    const normalizedQuery = query.toLocaleLowerCase()
    const main = result.threads.filter((thread) => !thread.internal)
    const groups = groupThreads(result.threads, this.snapshot, 'projects')
    const customProjects = this.snapshot.projects.filter((project) => project.kind === 'threadbox')
    const projectItems: SidebarItem[] = customProjects.flatMap((project) => {
      const group = groups.find((item) => item.kind === 'threadboxProject' && item.projectId === project.id)
      const allThreads = group?.threads ?? []
      const displayName = project.systemKind === 'trash' ? copy.trash : project.name
      const threads = filterSidebarThreads(allThreads, query, displayName)
      const projectMatches = displayName.toLocaleLowerCase().includes(normalizedQuery)
      if (query && threads.length === 0 && !projectMatches) return []
      const inTrash = project.systemKind === 'trash'
      return [new SidebarItem(displayName, { kind: 'project',
        id: `threadbox:project:${project.id}`,
        description: String(inTrash
          ? threads.filter((thread) => !thread.internal).length
          : this.visibleCount(threads)),
        icon: inTrash ? 'trash' : 'folder-library',
        tooltip: inTrash ? copy.trash : project.name,
        children: this.projectChildren(threads, copy, project.id, allThreads, inTrash),
        contextValue: inTrash
          ? 'threadbox.project.threadbox.trash'
          : 'threadbox.project.threadbox.mutable',
        project })]
    })
    const unassignedMatches = copy.unassigned.toLocaleLowerCase().includes(normalizedQuery)
    const unassignedGroups = groups.filter((group) =>
      group.kind === 'localWorkspace' || group.kind === 'standalone')
    const unassignedChildren = unassignedGroups.flatMap((group) => {
      const threads = filterSidebarThreads(group.threads, unassignedMatches ? '' : query, group.name)
      if (threads.length === 0) return []
      return [new SidebarItem(group.name || copy.unassigned, {
        id: `threadbox:directory:${group.id}`,
        kind: 'directory', description: String(this.visibleCount(threads)), icon: 'folder',
        tooltip: group.directories.join('\n'),
        children: this.projectChildren(threads, copy, group.id, group.threads),
        contextValue: 'threadbox.group.directory',
        selectionIds: filterSidebarThreads(group.threads, '').map((thread) => thread.id)
      })]
    })
    if (unassignedChildren.length > 0 || !query) {
      projectItems.push(new SidebarItem(copy.unassigned, { kind: 'unassigned',
        id: 'threadbox:project:unassigned',
        description: String(unassignedChildren.reduce((count, item) =>
          count + Number(item.description ?? 0), 0)),
        icon: 'inbox', children: unassignedChildren, contextValue: 'threadbox.project.unassigned' }))
    }
    const activeCount = main.filter((thread) => !thread.archived).length
    this.summaryChanged.fire({ taskCount: activeCount, tooltip: `${activeCount} tasks` })
    const children = projectItems.length > 0 ? projectItems : [new SidebarItem(copy.noResults, {
      id: 'threadbox:no-results', kind: 'status', icon: 'search-stop', tooltip: copy.noResults
    })]
    const inventoryItems = result.inventory.state === 'partial'
      ? [new SidebarItem(copy.partialInventory, {
          id: 'threadbox:partial-inventory',
          kind: 'status',
          icon: 'warning',
          tooltip: result.inventory.message ?? copy.partialInventory
        })]
      : []
    return [...this.environmentItems(result.environment, copy), ...inventoryItems,
      new SidebarItem(copy.projects, {
      id: 'threadbox:projects', kind: 'section', description: String(this.snapshot.projects.length),
      icon: 'project', children,
      contextValue: 'threadbox.projects'
      })]
  }

  private async loadRootItems(): Promise<SidebarItem[]> {
    const copy = labels(this.locale)
    if (!vscode.workspace.isTrusted) {
      this.summaryChanged.fire({ taskCount: 0, tooltip: copy.workspaceTrust })
      return [new SidebarItem(copy.workspaceTrust, {
        id: 'threadbox:workspace-trust', kind: 'status', icon: 'shield', tooltip: copy.workspaceTrust
      })]
    }
    if (this.loaded) return this.buildLoadedRootItems(this.loaded, copy)
    let status: EnvironmentStatus
    try { status = await this.api.getEnvironmentStatus() }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [new SidebarItem(copy.unavailable, { id: 'threadbox:unavailable',
        kind: 'status', description: message, icon: 'error',
        command: this.settingsCommand(copy.settings), tooltip: message })]
    }
    if (status.state !== 'ready') {
      this.summaryChanged.fire({ taskCount: 0, tooltip: status.message ?? copy.unavailable })
      return [...this.environmentItems(status, copy), new SidebarItem(copy.settings, {
        id: 'threadbox:settings', kind: 'action', icon: 'settings-gear',
        command: this.settingsCommand(copy.settings)
      })]
    }
    try {
      const result = await this.api.listThreads()
      const snapshot = await this.api.listProjects()
      this.loaded = { result, snapshot }
      return this.buildLoadedRootItems(this.loaded, copy)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.summaryChanged.fire({ taskCount: 0, tooltip: message })
      return [...this.environmentItems(status, copy), new SidebarItem(copy.loadFailed, {
        id: 'threadbox:load-error', kind: 'status', description: message, icon: 'error', tooltip: message
      })]
    }
  }

  private async showError(error: unknown): Promise<void> {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}
