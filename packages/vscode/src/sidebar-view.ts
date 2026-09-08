import type { ThreadRecord } from '../../../src/shared/contracts'
import { directoryKey, owningThread, resolveThreadSelection } from '../../core/src/thread-utils'

export interface SidebarViewOptions {
  scope: 'all' | 'workspace'
  archive: 'all' | 'active' | 'archived'
  sort: 'updated-desc' | 'updated-asc' | 'title-asc'
}
export const DEFAULT_SIDEBAR_VIEW: SidebarViewOptions = { scope: 'all', archive: 'all', sort: 'updated-desc' }

function pathKey(path: string): string {
  const key = directoryKey(path)
  return /^[a-z]:/iu.test(key) ? key.toLocaleLowerCase() : key
}

export function parseSidebarView(value: unknown): SidebarViewOptions {
  const item = (typeof value === 'object' && value !== null ? value : {}) as Partial<SidebarViewOptions>
  return {
    scope: item.scope === 'workspace' ? 'workspace' : 'all',
    archive: item.archive === 'active' || item.archive === 'archived' ? item.archive : 'all',
    sort: item.sort === 'updated-asc' || item.sort === 'title-asc' ? item.sort : 'updated-desc'
  }
}

export function sidebarMatches(
  threads: readonly ThreadRecord[], query: string, groupName: string,
  options: SidebarViewOptions, workspaces: readonly string[], trash = false
): { threads: ThreadRecord[]; matches: Set<string> } {
  const visible = threads.filter((thread) => !thread.internal || thread.source === 'subAgentThreadSpawn')
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const text = query.trim().toLocaleLowerCase()
  const matches = new Set(visible.filter((thread) => {
    if (options.scope === 'workspace') {
      const cwd = pathKey(owningThread(thread, byId).cwd)
      if (!workspaces.some((path) => {
        const root = pathKey(path)
        return cwd === root || cwd.startsWith(root + '/')
      })) return false
    }
    if (!trash && options.archive !== 'all' && thread.archived !== (options.archive === 'archived')) return false
    return !text || [groupName, thread.title, thread.preview, thread.cwd, thread.id, thread.source]
      .join('\n').toLocaleLowerCase().includes(text)
  }).map((thread) => thread.id))
  const included = new Set(matches)
  for (const id of matches) {
    let parent = byId.get(id)?.parentThreadId
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      included.add(parent)
      parent = byId.get(parent)?.parentThreadId
    }
  }
  return { threads: visible.filter((thread) => included.has(thread.id)), matches }
}

export function sidebarOrder(mode: SidebarViewOptions['sort']): (a: ThreadRecord, b: ThreadRecord) => number {
  return (a, b) => (mode === 'title-asc' ? a.title.localeCompare(b.title)
    : mode === 'updated-asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id)
}

export function selectionDetails(threads: ThreadRecord[], ids: readonly string[], chinese: boolean): string {
  const selected = resolveThreadSelection(threads, ids)
  const roots = threads.filter((thread) => selected.roots.has(thread.id))
  const summary = chinese
    ? '涉及 ' + roots.length + ' 个主任务，连带 ' + selected.implicit.size + ' 个子任务。'
    : roots.length + ' root tasks, including ' + selected.implicit.size + ' descendant tasks.'
  return [summary, chinese ? '子任务可能未显示在当前筛选结果中。' : 'Descendants may be outside the current filters.',
    ...roots.slice(0, 20).map((thread) => thread.title + ' [' + thread.id + ']'),
    ...(roots.length > 20 ? ['… +' + (roots.length - 20)] : [])].join('\n')
}

export function taskTooltip(thread: ThreadRecord, locale: string): string {
  const zh = locale.toLowerCase().startsWith('zh')
  const date = (value: number): string => Number.isFinite(value)
    ? new Date(value * 1000).toLocaleString(locale) : '-'
  const states: Record<string, string> = zh
    ? { active: '运行中', idle: '空闲', notLoaded: '未加载', systemError: '异常', unknown: '未知' }
    : { active: 'Running', idle: 'Idle', notLoaded: 'Not loaded', systemError: 'Error', unknown: 'Unknown' }
  return [thread.title, 'ID: ' + thread.id, (zh ? '目录: ' : 'Directory: ') + thread.cwd,
    (zh ? '创建: ' : 'Created: ') + date(thread.createdAt), (zh ? '更新: ' : 'Updated: ') + date(thread.updatedAt),
    (zh ? '来源: ' : 'Source: ') + thread.source, (zh ? '状态: ' : 'Status: ') + (states[thread.status] ?? thread.status),
    ...(thread.archived ? [zh ? '已归档' : 'Archived'] : []), ...(thread.pinned ? [zh ? '已置顶' : 'Pinned'] : [])].join('\n')
}
