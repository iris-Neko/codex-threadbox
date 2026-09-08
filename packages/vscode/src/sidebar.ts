import { basename } from 'node:path'
import * as vscode from 'vscode'
import type {
  BatchOperationResult,
  EnvironmentStatus,
  ListThreadsResult,
  ProjectRecord,
  ProjectSnapshot,
  ThreadboxApi,
  ThreadRecord
} from '../../../src/shared/contracts'
import { groupThreads, resolveThreadSelection, deselectThreadSubtrees, toggleThreadSelection } from '../../core/src/thread-utils'
import {
  actionableRootIds,
  buildVisibleThreadHierarchy,
  collectThreadIds,
  manualMoveTargets,
  selectedRootIds,
  type ThreadHierarchyNode
} from './sidebar-selection'
import { batchNotice, ProjectAssignmentError } from './operation-feedback'
import { requireWorkspaceTrust } from './workspace-trust'
import { normalizeThreadName } from '../../../src/shared/thread-name'
import { DEFAULT_SIDEBAR_VIEW, parseSidebarView, sidebarMatches, sidebarOrder, selectionDetails, taskTooltip, type SidebarViewOptions } from './sidebar-view'

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
      noEligibleTasks: '请先选择或勾选对话。',
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
    noEligibleTasks: 'Select or check one or more tasks first.',
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
  checked?: boolean
  expanded?: boolean
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
    if (options.checked !== undefined) this.checkboxState = options.checked
      ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked
    if (options.expanded && options.children?.length) this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
  }
}

export interface SidebarSummary { taskCount: number; tooltip: string; checkedCount?: number }

export interface SidebarPreferences {
  load(): unknown
  save(options: SidebarViewOptions): PromiseLike<void>
  directories(): readonly string[]
}

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
  private operationLog: vscode.OutputChannel | null = null
  private disposed = false
  private options: SidebarViewOptions = { ...DEFAULT_SIDEBAR_VIEW }
  private checked = new Set<string>()
  private matches = new Set<string>()
  private trashMatches = new Set<string>()
  private effectiveChecked = new Set<string>()
  private multiSelectMode = false

  toggleMultiSelect(): void {
    this.multiSelectMode = !this.multiSelectMode
    this.checked.clear()
    void vscode.commands.executeCommand('setContext', 'threadbox.multiSelectMode', this.multiSelectMode)
    this.redraw()
  }

  readonly onDidChangeTreeData = this.changed.event
  readonly onDidChangeSummary = this.summaryChanged.event
  readonly onDidChangeSearch = this.searchChanged.event
  readonly dragMimeTypes = [TREE_MIME]
  readonly dropMimeTypes = [TREE_MIME]

  constructor(
    private readonly api: ThreadboxApi,
    private readonly openThreadCommand: string,
    private readonly updateCodexCliCommand: string,
    private locale: string,
    private readonly recoverWriter?: (ids: string[]) => Promise<BatchOperationResult | null>,
    private readonly preferences?: SidebarPreferences
  ) { this.options = parseSidebarView(preferences?.load()) }

  setLocale(locale: string): void { this.locale = locale; this.refresh() }

  async filter(): Promise<void> {
    const zh = this.locale.toLowerCase().startsWith('zh')
    const choices = [
      { label: zh ? '全部工作区' : 'All workspaces', change: { scope: 'all' as const } },
      ...(this.preferences?.directories().length ? [{ label: zh ? '当前工作区' : 'Current workspace', change: { scope: 'workspace' as const } }] : []),
      { label: zh ? '全部归档状态' : 'All archive states', change: { archive: 'all' as const } },
      { label: zh ? '仅未归档' : 'Unarchived only', change: { archive: 'active' as const } },
      { label: zh ? '仅已归档' : 'Archived only', change: { archive: 'archived' as const } }
    ]
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: zh ? '筛选对话（垃圾箱单独显示）' : 'Filter tasks (Trash stays separate)' })
    if (picked) await this.setView(picked.change)
  }

  async sort(): Promise<void> {
    const zh = this.locale.toLowerCase().startsWith('zh')
    const picked = await vscode.window.showQuickPick([
      { label: zh ? '最近更新' : 'Recently updated', value: 'updated-desc' as const },
      { label: zh ? '最久未更新' : 'Oldest updated', value: 'updated-asc' as const },
      { label: zh ? '按名称' : 'Name', value: 'title-asc' as const }
    ], { placeHolder: zh ? '排序' : 'Sort tasks' })
    if (picked) await this.setView({ sort: picked.value })
  }

  async setView(change: Partial<SidebarViewOptions>): Promise<void> {
    this.options = parseSidebarView({ ...this.options, ...change })
    this.checked.clear()
    await this.preferences?.save(this.options)
    this.redraw()
  }

  async resetFilters(): Promise<void> {
    this.searchQuery = ''
    await this.setView({ scope: 'all', archive: 'all' })
  }

  async selectFiltered(): Promise<void> {
    if (!this.multiSelectMode) this.toggleMultiSelect()
    await this.getChildren()
    this.checked = resolveThreadSelection(this.loaded?.result.threads ?? [],
      [...this.matches].filter((id) => !this.trashMatches.has(id))).roots
    this.redraw()
  }

  clearSelection(): void { this.checked.clear(); this.redraw() }

  checkItems(changes: readonly [SidebarItem, vscode.TreeItemCheckboxState][]): void {
    if (!this.multiSelectMode) return
    const threads = this.loaded?.result.threads ?? []
    for (const [item, state] of changes) {
      const id = item.thread?.id
      if (!id || !this.matches.has(id)) continue
      if (state === vscode.TreeItemCheckboxState.Checked) this.checked = toggleThreadSelection(threads, this.checked, id)
      else this.checked = deselectThreadSubtrees(threads, this.checked, [id])
    }
    this.redraw()
  }

  private description(): string {
    const zh = this.locale.toLowerCase().startsWith('zh')
    return [this.searchQuery, this.options.scope === 'workspace' ? zh ? '当前工作区' : 'Current workspace' : '',
      this.options.archive === 'all' ? '' : this.options.archive === 'active' ? zh ? '未归档' : 'Unarchived' : zh ? '已归档' : 'Archived',
      this.options.sort === 'updated-asc' ? zh ? '最久未更新' : 'Oldest first' : this.options.sort === 'title-asc' ? zh ? '按名称' : 'By name' : '',
      this.checked.size ? (zh ? '已勾选 ' : 'Checked ') + this.checked.size : ''].filter(Boolean).join(' · ')
  }

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
  dispose(): void {
    this.disposed = true
    this.changed.dispose()
    this.summaryChanged.dispose()
    this.searchChanged.dispose()
    this.operationLog?.dispose()
  }

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
    this.checked.clear()
    if (this.loaded) this.redraw()
  }

  private redraw(): void {
    this.cached = null
    this.searchChanged.fire(this.description())
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
    const archiveTarget = target?.kind === 'archive' || target?.contextValue === 'threadbox.group.archive'
    if (!item || !target || (!archiveTarget && target.kind !== 'project' && target.kind !== 'unassigned') ||
      (target.kind === 'project' && target.project?.kind !== 'threadbox')) return
    try {
      const value: unknown = JSON.parse(await item.asString())
      if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return
      if (archiveTarget) {
        const threads = this.loaded?.result.threads ?? []
        if (value.some((id) => !threads.some((thread) => thread.id === id))) throw new Error('Refresh the task list before dragging.')
        await this.archiveThreads(value.map((id) => new SidebarItem(id, { kind: 'thread', thread: threads.find((thread) => thread.id === id)! })), true)
        return
      }
      const targetProjectId = target.project?.id ?? null
      const ids = this.actionableRootIds(value, targetProjectId)
      if (ids.length === 0) return
      await this.assignAndRefresh(ids, targetProjectId)
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

  async renameThread(item?: SidebarItem): Promise<void> {
    if (!item?.thread || !this.api.renameThread) return
    try {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const chinese = this.locale.toLowerCase().startsWith('zh')
      if (item.thread.archived || item.contextValue?.startsWith('threadbox.thread.trash.')) {
        void vscode.window.showWarningMessage(chinese
          ? '请先恢复归档或垃圾箱中的对话，再重命名。' : 'Restore archived or trashed tasks before renaming.')
        return
      }
      const value = await vscode.window.showInputBox({
        prompt: chinese ? '重命名对话' : 'Rename task',
        value: item.thread.title, valueSelection: [0, item.thread.title.length],
        validateInput: (name) => {
          try { normalizeThreadName(name); return null } catch {
            return chinese ? '请输入 1-512 个可见字符。' : 'Enter 1-512 visible characters.'
          }
        }
      })
      if (value === undefined) return
      const name = normalizeThreadName(value)
      if (name === item.thread.title) return
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await this.api.renameThread(item.thread.id, name)
      await this.refreshNow()
      void vscode.window.showInformationMessage(chinese ? '对话名称已更新。' : 'Task renamed.')
    } catch (error) { await this.showError(error) }
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
      await this.assignAndRefresh(ids, projectId)
    }
    catch (error) { await this.showError(error) }
  }

  private actionableRootIds(ids: readonly string[], projectId: string | null): string[] {
    const ordinary = actionableRootIds(
      this.loaded?.result.threads ?? [],
      this.snapshot.assignments,
      ids,
      projectId
    )
    const archived = selectedRootIds(this.loaded?.result.threads ?? [], ids).filter((id) =>
      this.loaded?.result.threads.some((thread) => thread.id === id && thread.archived))
    return [...new Set([...ordinary, ...archived])]
  }

  private selectedIds(items: readonly SidebarItem[]): string[] {
    if (!items.length) return [...this.checked]
    const checked = resolveThreadSelection(this.loaded?.result.threads ?? [], this.checked).effective
    if (items.some((item) => item.thread && checked.has(item.thread.id))) return [...this.checked]
    return [...new Set(items.flatMap((item) => item.thread ? [item.thread.id] : item.selectionIds ?? collectThreadIds([item])))]
  }

  private async assignAndRefresh(ids: string[], projectId: string | null): Promise<void> {
    const scope = await this.operationScope(ids)
    const trash = this.snapshot.projects.some((project) => project.id === projectId && project.systemKind === 'trash')
    const trashId = this.snapshot.projects.find((project) => project.systemKind === 'trash')?.id
    const archived = trash ? [] : scope.roots.filter((id) =>
      (!trashId || this.snapshot.assignments[id] !== trashId) && this.loaded?.result.threads.some((thread) => thread.id === id && thread.archived))
    if (trash || archived.length || scope.descendants > 0 || scope.roots.length > 1) {
      const copy = labels(this.locale)
      const action = trash ? copy.moveToTrash : copy.moveToProject
      const detail = scope.detail + (archived.length ? (this.locale.startsWith('zh')
        ? '\n归档对话会先恢复，再移动到目标分组。' : '\nArchived tasks will be restored before moving to the target group.') : '')
      if (await vscode.window.showWarningMessage(action, { modal: true, detail }, action) !== action) return
    }
    requireWorkspaceTrust(vscode.workspace.isTrusted)
    let restoredIds: string[] = []
    try {
      let targets = scope.roots
      if (archived.length) {
        const restored = await this.api.unarchiveThreads(archived)
        restoredIds = restored.succeeded
        targets = targets.filter((id) => !archived.includes(id) || restored.succeeded.includes(id))
        if (restored.failed.length || restored.skipped.length) this.reportBatch(restored)
      }
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      if (targets.length) this.updateSnapshot(await this.api.assignThreads(targets, projectId))
    } catch (error) {
      if (restoredIds.length) {
        const rolledBack = await this.api.archiveThreads(restoredIds).catch(() => null)
        const unrecovered = restoredIds.filter((id) => !rolledBack?.succeeded.includes(id))
        if (unrecovered.length) throw new Error('Move failed and archive rollback failed for tasks: ' + unrecovered.join(', '), { cause: error })
      }
      throw error
    }
    finally { this.checked.clear(); await this.refreshNow() }
  }

  private async operationScope(ids: string[]): Promise<{ roots: string[]; detail: string; descendants: number }> {
    requireWorkspaceTrust(vscode.workspace.isTrusted)
    const result = await this.api.listThreads()
    requireWorkspaceTrust(vscode.workspace.isTrusted)
    if (result.inventory.state !== 'complete') throw new Error(result.inventory.message ?? 'Task inventory is incomplete. Refresh and retry.')
    if (ids.some((id) => !result.threads.some((thread) => thread.id === id))) throw new Error('A selected task no longer exists. Refresh and retry.')
    this.loaded = { result, snapshot: await this.api.listProjects() }
    requireWorkspaceTrust(vscode.workspace.isTrusted)
    this.snapshot = this.loaded.snapshot
    const roots = selectedRootIds(result.threads, ids)
    const selection = resolveThreadSelection(result.threads, roots)
    return { roots, descendants: selection.implicit.size,
      detail: selectionDetails(result.threads, roots, this.locale.toLowerCase().startsWith('zh')) }
  }

  private async finishBatch(
    result: BatchOperationResult,
    retry?: (ids: string[]) => Promise<BatchOperationResult>,
    recoverToTrash = false
  ): Promise<void> {
    this.checked.clear()
    await this.refreshNow()
    this.reportBatch(result, retry, recoverToTrash)
  }

  private reportBatch(
    result: BatchOperationResult,
    retry?: (ids: string[]) => Promise<BatchOperationResult>,
    recoverToTrash = false
  ): void {
    if (this.disposed) return
    const titles = new Map((this.loaded?.result.threads ?? []).map((thread) => [thread.id, thread.title]))
    const notice = batchNotice(result, this.locale, titles)
    if (result.failed.length > 0 || result.skipped.length > 0) {
      const chinese = this.locale.toLowerCase().startsWith('zh')
      const details = chinese ? '查看详情' : 'View Details'
      const open = chinese ? '在 Codex 中打开' : 'Open in Codex'
      const retryLabel = chinese ? '重试' : 'Retry'
      const recoverLabel = chinese ? '释放占用并重试' : 'Release Writer and Retry'
      const canRecover = recoverToTrash && this.recoverWriter && notice.lockedIds.length === 1
      const actions = [details]
      if (notice.lockedIds.length === 1) actions.unshift(open)
      if (retry && !canRecover) actions.push(retryLabel)
      if (canRecover) actions.unshift(recoverLabel)
      this.operationLog ??= vscode.window.createOutputChannel('Threadbox')
      this.operationLog.appendLine(new Date().toISOString() + '\n' + notice.details)
      void Promise.resolve(vscode.window.showWarningMessage(notice.message, ...actions)).then(async (choice) => {
        if (this.disposed) return
        if (choice === details) { this.operationLog?.show(true); return }
        if (choice !== open && choice !== retryLabel && choice !== recoverLabel) return
        requireWorkspaceTrust(vscode.workspace.isTrusted)
        if (choice === open && notice.lockedIds.length === 1) {
          await vscode.commands.executeCommand('threadbox.openInCodex', notice.lockedIds[0])
        } else if (choice === retryLabel && retry) {
          const succeeded = new Set(result.succeeded)
          const ids = [...new Set([...result.failed, ...result.skipped].map((issue) => issue.id))]
            .filter((id) => !succeeded.has(id))
          if (ids.length > 0) await this.finishBatch(await retry(ids), retry, recoverToTrash)
        } else if (choice === recoverLabel && canRecover) {
          const recovered = await this.recoverWriter!(notice.lockedIds)
          if (recovered) await this.finishBatch(recovered, retry, recoverToTrash)
          else await this.refreshNow()
        }
      }).catch((error: unknown) => this.showError(error))
    } else {
      void vscode.window.showInformationMessage(notice.message)
    }
  }

  async archiveThreads(items: readonly SidebarItem[], archived: boolean): Promise<void> {
    const ids = this.selectedIds(items)
    if (!ids.length) return
    try {
      const scope = await this.operationScope(ids)
      const trashId = this.snapshot.projects.find((project) => project.systemKind === 'trash')?.id
      if (trashId && scope.roots.some((id) => this.snapshot.assignments[id] === trashId)) {
        throw new Error(this.locale.startsWith('zh') ? '垃圾箱中的对话请使用“从垃圾箱恢复”。' : 'Use Restore from Trash for tasks in Trash.')
      }
      const action = archived ? (this.locale.startsWith('zh') ? '归档' : 'Archive') : (this.locale.startsWith('zh') ? '取消归档' : 'Unarchive')
      if (await vscode.window.showWarningMessage(action, { modal: true, detail: scope.detail }, action) !== action) return
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await this.finishBatch(archived ? await this.api.archiveThreads(scope.roots) : await this.api.unarchiveThreads(scope.roots))
    } catch (error) { await this.showError(error) }
  }

  async pinThreads(items: readonly SidebarItem[], pinned: boolean): Promise<void> {
    const threads = items.flatMap((item) => item.thread ? [item.thread] : [])
      .filter((thread) => thread.status !== 'active' && thread.pinned !== pinned)
    if (threads.length === 0) return
    try { await this.finishBatch(await this.api.setPinned(threads.map((thread) => thread.id), pinned)) }
    catch (error) { await this.showError(error) }
  }

  async deleteThreads(items: readonly SidebarItem[]): Promise<void> {
    const copy = labels(this.locale)
    const ids = this.selectedIds(items)
    if (!ids.length) { void vscode.window.showWarningMessage(copy.noEligibleTasks); return }
    try {
      const scope = await this.operationScope(ids)
      const confirmed = await vscode.window.showWarningMessage(copy.moveToTrashConfirm,
        { modal: true, detail: scope.detail }, copy.moveToTrash)
      if (confirmed !== copy.moveToTrash) return
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const move = (targets: string[]): Promise<BatchOperationResult> => this.api.trashThreads
        ? this.api.trashThreads(targets) : this.api.deleteThreads(targets, { trashWorkingDirectories: [] })
      await this.finishBatch(await move(scope.roots), move, true)
    } catch (error) { await this.showError(error) }
  }

  async restoreThreads(items: readonly SidebarItem[]): Promise<void> {
    const ids = this.selectedIds(items)
    if (!ids.length || !this.api.restoreThreadsFromTrash) return
    try {
      const scope = await this.operationScope(ids)
      const copy = labels(this.locale)
      if (await vscode.window.showWarningMessage(copy.restoreFromTrash,
        { modal: true, detail: scope.detail }, copy.restoreFromTrash) !== copy.restoreFromTrash) return
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await this.finishBatch(await this.api.restoreThreadsFromTrash(scope.roots), (targets) => this.api.restoreThreadsFromTrash!(targets))
    } catch (error) { await this.showError(error) }
  }

  async emptyTrash(item?: SidebarItem): Promise<void> {
    if (item?.project?.systemKind !== 'trash' || !this.api.emptyTrash) return
    const copy = labels(this.locale)
    try {
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      const listed = await this.api.listThreads()
      if (listed.inventory.state !== 'complete') throw new Error('Task inventory is incomplete.')
      const projects = await this.api.listProjects()
      const ids = Object.entries(projects.assignments).filter(([, id]) => id === item.project!.id).map(([id]) => id)
      const detail = (this.locale.startsWith('zh') ? '清空整个垃圾箱，不受当前筛选影响。' : 'Empty the ENTIRE Trash, regardless of current filters.') +
        '\n' + selectionDetails(listed.threads, ids, this.locale.startsWith('zh'))
      if (await vscode.window.showWarningMessage(copy.emptyTrashConfirm, { modal: true, detail }, copy.emptyTrash) !== copy.emptyTrash) return
      requireWorkspaceTrust(vscode.workspace.isTrusted)
      await this.finishBatch(await this.api.emptyTrash())
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

  private threadItems(threads: ThreadRecord[], inTrash = false, location = 'active'): SidebarItem[] {
    const visit = (node: ThreadHierarchyNode): SidebarItem => {
      const thread = node.thread
      const children = node.children.map(visit)
      const archive = thread.archived ? 'archived' : 'active'
      const pin = !this.loaded?.result.environment.capabilities.pinning
        ? 'pinUnavailable' : thread.pinned ? 'pinned' : 'unpinned'
      return new SidebarItem(thread.title, {
        id: `threadbox:thread:${location}:${thread.id}`,
        kind: 'thread', description: basename(thread.cwd),
        icon: thread.status === 'active' ? 'sync~spin' : thread.pinned ? 'pinned' : 'comment-discussion',
        command: this.threadCommand(thread), tooltip: taskTooltip(thread, this.locale),
        checked: this.multiSelectMode && this.matches.has(thread.id) && (inTrash || thread.archived === (location === 'archived'))
          ? this.effectiveChecked.has(thread.id) : undefined,
        expanded: this.searchQuery.trim().length > 0,
        children: children.length > 0 ? children : undefined,
        contextValue: inTrash
          ? `threadbox.thread.trash.${archive}.${pin}`
          : `threadbox.thread.${archive}.${pin}`,
        thread
      })
    }
    return buildVisibleThreadHierarchy(threads, sidebarOrder(this.options.sort)).map(visit)
  }

  private projectChildren(threads: ThreadRecord[], inTrash = false): SidebarItem[] {
    return this.threadItems(threads, inTrash, inTrash ? 'trash' : 'active')
  }

  private buildLoadedRootItems(data: LoadedSidebarData, copy: SidebarLabels): SidebarItem[] {
    this.snapshot = data.snapshot
    this.effectiveChecked = resolveThreadSelection(data.result.threads, this.checked).effective
    const workspaces = this.preferences?.directories() ?? []
    if (!workspaces.length && this.options.scope === 'workspace') this.options.scope = 'all'
    this.matches.clear()
    this.trashMatches.clear()
    const filtered = (threads: ThreadRecord[], name: string, trash = false, archived = false): ThreadRecord[] => {
      if (!trash && this.options.archive !== 'all' && archived !== (this.options.archive === 'archived')) return []
      const options = { ...this.options, archive: archived ? 'archived' as const : 'active' as const }
      const result = sidebarMatches(threads, this.searchQuery, name, options, workspaces, trash)
      for (const id of result.matches) { this.matches.add(id); if (trash) this.trashMatches.add(id) }
      return result.threads
    }
    const groups = groupThreads(data.result.threads, this.snapshot, 'projects')
    const count = (threads: ThreadRecord[]): number => threads.filter((thread) => this.matches.has(thread.id) && !thread.internal).length
    const projectItems: SidebarItem[] = []
    for (const project of this.snapshot.projects.filter((project) => project.kind === 'threadbox')) {
      const trash = project.systemKind === 'trash'
      const name = trash ? copy.trash : project.name
      const group = groups.find((item) => item.kind === 'threadboxProject' && item.projectId === project.id)
      const threads = filtered(group?.threads ?? [], name, trash)
      const filtering = this.searchQuery.trim() || this.options.scope !== 'all' || this.options.archive !== 'all'
      if (!trash && !threads.length && filtering) continue
      projectItems.push(new SidebarItem(name, {
        kind: 'project', id: 'threadbox:project:' + project.id, icon: trash ? 'trash' : 'folder-library',
        description: String(count(threads)), tooltip: name, project,
        expanded: Boolean(this.searchQuery.trim()) || this.options.archive === 'archived',
        children: this.projectChildren(threads, trash),
        selectionIds: threads.filter((thread) => this.matches.has(thread.id)).map((thread) => thread.id),
        contextValue: trash ? 'threadbox.project.threadbox.trash' : 'threadbox.project.threadbox.mutable'
      }))
    }
    const directories: SidebarItem[] = []
    for (const group of groups.filter((item) => item.kind === 'localWorkspace' || item.kind === 'standalone')) {
      const threads = filtered(group.threads, group.name)
      if (!threads.length) continue
      directories.push(new SidebarItem(group.name || copy.unassigned, {
        id: 'threadbox:directory:' + group.id, kind: 'directory', icon: 'folder',
        description: String(count(threads)), tooltip: group.directories.join('\n'),
        expanded: Boolean(this.searchQuery.trim()) || this.options.archive === 'archived',
        children: this.projectChildren(threads), contextValue: 'threadbox.group.directory',
        selectionIds: threads.filter((thread) => this.matches.has(thread.id)).map((thread) => thread.id)
      }))
    }
    projectItems.push(new SidebarItem(copy.unassigned, {
      kind: 'unassigned', id: 'threadbox:project:unassigned', icon: 'inbox', children: directories,
      expanded: Boolean(this.searchQuery.trim()) || this.options.archive === 'archived', contextValue: 'threadbox.project.unassigned'
    }))
    const archiveDirectories: SidebarItem[] = []
    const trashIds = new Set(groups.filter((group) => group.project?.systemKind === 'trash')
      .flatMap((group) => group.threads.map((thread) => thread.id)))
    const ordinary = data.result.threads.filter((thread) => !trashIds.has(thread.id))
    for (const group of groupThreads(ordinary, null, 'directories')) {
      const threads = filtered(group.threads, group.name, false, true)
      if (!threads.length) continue
      archiveDirectories.push(new SidebarItem(group.name, {
        id: 'threadbox:archived-directory:' + group.id, kind: 'directory', icon: 'folder',
        description: String(count(threads.filter((thread) => thread.archived))),
        tooltip: group.directories.join('\n'), expanded: Boolean(this.searchQuery.trim()),
        children: this.threadItems(threads, false, 'archived'), contextValue: 'threadbox.group.archive',
        selectionIds: threads.filter((thread) => thread.archived && this.matches.has(thread.id)).map((thread) => thread.id)
      }))
    }
    projectItems.push(new SidebarItem(copy.archived, {
      id: 'threadbox:project:archived', kind: 'archive', icon: 'archive', children: archiveDirectories,
      expanded: this.options.archive === 'archived' || Boolean(this.searchQuery.trim()),
      description: String(ordinary.filter((thread) => thread.archived && !thread.internal && this.matches.has(thread.id)).length),
      contextValue: 'threadbox.group.archive',
      selectionIds: ordinary.filter((thread) => thread.archived && this.matches.has(thread.id)).map((thread) => thread.id)
    }))
    this.checked = new Set([...this.checked].filter((id) => this.matches.has(id)))
    const taskCount = data.result.threads.filter((thread) => !thread.internal && this.matches.has(thread.id) && !this.trashMatches.has(thread.id)).length
    this.summaryChanged.fire({ taskCount, tooltip: taskCount + ' matching tasks (Trash excluded)', checkedCount: this.checked.size })
    this.searchChanged.fire(this.description())
    const issues = data.result.inventory.state === 'partial' ? [new SidebarItem(copy.partialInventory, {
      id: 'threadbox:partial-inventory', kind: 'status', icon: 'warning', tooltip: data.result.inventory.message ?? copy.partialInventory
    })] : []
    if (!taskCount) issues.push(new SidebarItem(copy.noResults, {
      id: 'threadbox:no-results', kind: 'status', icon: 'search-stop',
      command: { command: 'threadbox.resetFilters', title: copy.noResults }
    }))
    return [...this.environmentItems(data.result.environment, copy), ...issues, new SidebarItem(copy.projects, {
      id: 'threadbox:projects', kind: 'section', icon: 'project', expanded: true,
      children: projectItems, contextValue: 'threadbox.projects'
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
    if (error instanceof ProjectAssignmentError) {
      this.reportBatch(error.result, undefined, error.operation === 'trash')
      return
    }
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}
