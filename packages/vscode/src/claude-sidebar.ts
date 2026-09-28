import * as vscode from 'vscode'
import { groupClaudeSessions, type ClaudeHistoryReader, type ClaudeSession } from './claude-history'

export class ClaudeHistoryItem extends vscode.TreeItem {
  constructor(label: string, readonly children?: ClaudeHistoryItem[], readonly session?: ClaudeSession) {
    super(label, children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)
  }
}

export interface ClaudeSidebarHost {
  guard(): void
  configDir(): string
  locale(): string
  open(session: ClaudeSession, configDir: string): Promise<void>
}

export class ClaudeHistorySidebar implements vscode.TreeDataProvider<ClaudeHistoryItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  private sessions = new Map<string, ClaudeSession>()
  private loaded: ClaudeSession[] | undefined
  private pending: Promise<ClaudeHistoryItem[]> | undefined
  private generation = 0
  private disposed = false
  private query = ''
  constructor(private readonly reader: ClaudeHistoryReader, private readonly host: ClaudeSidebarHost) {}

  getTreeItem(item: ClaudeHistoryItem): vscode.TreeItem { return item }
  private get chinese(): boolean { return this.host.locale().startsWith('zh') }
  refresh(): void {
    this.generation++
    this.pending = undefined
    this.loaded = undefined
    this.sessions.clear()
    this.changed.fire()
  }
  async search(): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: this.chinese ? '搜索所有文件夹的 Claude Code 对话（名称、目录或 ID）' : 'Search Claude Code history across all folders (title, directory or ID)',
      value: this.query
    })
    if (query === undefined || this.disposed) return
    this.query = query.trim()
    this.changed.fire()
  }
  clearSearch(): void { this.query = ''; this.changed.fire() }
  async getChildren(item?: ClaudeHistoryItem): Promise<ClaudeHistoryItem[]> {
    try { this.host.guard() } catch {
      this.sessions.clear()
      this.loaded = undefined
      return [this.status(this.chinese ? '请先信任工作区，再查看 Claude 历史。' : 'Trust this workspace to browse Claude history.', 'shield')]
    }
    if (item) return item.children ?? []
    if (this.loaded) return this.items(this.loaded)
    if (!this.pending) this.pending = this.load(this.generation)
    return this.pending
  }

  private async load(generation: number): Promise<ClaudeHistoryItem[]> {
    try {
      const sessions = await this.reader.list(this.host.configDir())
      this.host.guard()
      if (this.disposed || generation !== this.generation) return []
      this.loaded = sessions
      this.sessions = new Map(sessions.map((session) => [session.id, session]))
      return this.items(sessions)
    } catch (error) {
      if (this.disposed || generation !== this.generation) return []
      const row = this.status(this.chinese ? 'Claude 历史加载失败；点击重试' : 'Claude history could not load; click to retry', 'warning')
      row.tooltip = error instanceof Error ? error.message : 'Claude history unavailable.'
      row.command = { command: 'threadbox.claudeRefresh', title: 'Refresh' }
      return [row]
    }
  }

  private items(sessions: ClaudeSession[]): ClaudeHistoryItem[] {
    const groups = groupClaudeSessions(sessions, this.query)
    const rows = groups.map((group) => {
      const children = group.sessions.map((session) => {
        const row = new ClaudeHistoryItem(session.title, undefined, session)
        row.id = 'claude:session:' + session.id
        row.contextValue = 'threadbox.claude.session'
        row.iconPath = new vscode.ThemeIcon('comment-discussion')
        row.description = new Date(session.updatedAt).toLocaleDateString(this.host.locale())
        row.tooltip = [session.title, 'Claude Code', session.cwd ?? '', 'ID: ' + session.id,
          (this.chinese ? '更新：' : 'Updated: ') + new Date(session.updatedAt).toLocaleString(this.host.locale())].join('\n')
        row.command = { command: 'threadbox.claudeOpenOnDoubleClick', title: 'Open in Claude Code', arguments: [session.id] }
        return row
      })
      const row = new ClaudeHistoryItem(group.cwd ?? (this.chinese ? '未知工作目录' : 'Unknown working directory'), children)
      row.id = 'claude:directory:' + group.key
      row.description = String(children.length)
      row.tooltip = group.cwd ?? (this.chinese ? '历史记录没有目录，无法自动恢复。' : 'No original directory is recorded; automatic resume is unavailable.')
      row.iconPath = new vscode.ThemeIcon('folder')
      if (this.query) row.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
      return row
    })
    if (this.query) {
      const clear = this.status((this.chinese ? '清除搜索：' : 'Clear search: ') + this.query, 'clear-all')
      clear.command = { command: 'threadbox.claudeClearSearch', title: 'Clear search' }
      rows.unshift(clear)
    }
    if (!groups.length) rows.push(this.status(this.query
      ? this.chinese ? '没有匹配的对话' : 'No matching conversations'
      : this.chinese ? '此主机尚无 Claude Code 历史' : 'No Claude Code history on this host', 'info'))
    return rows
  }

  private status(label: string, icon: string): ClaudeHistoryItem {
    const row = new ClaudeHistoryItem(label)
    row.iconPath = new vscode.ThemeIcon(icon)
    return row
  }

  async open(value: unknown): Promise<void> {
    this.host.guard()
    const id = value instanceof ClaudeHistoryItem ? value.session?.id : value
    if (typeof id !== 'string') throw new Error('Select a Claude Code conversation first.')
    if (!this.loaded) await this.getChildren()
    this.host.guard()
    const session = this.sessions.get(id)
    if (!session) throw new Error('This Claude conversation is no longer in the history list. Refresh and try again.')
    await this.host.open(session, this.host.configDir())
  }

  async copyId(value: unknown): Promise<void> {
    this.host.guard()
    if (value instanceof ClaudeHistoryItem && value.session && this.sessions.has(value.session.id)) {
      await vscode.env.clipboard.writeText(value.session.id)
    }
  }

  dispose(): void { this.disposed = true; this.sessions.clear(); this.loaded = undefined; this.changed.dispose() }
}
