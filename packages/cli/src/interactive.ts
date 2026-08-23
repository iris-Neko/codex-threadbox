import { checkbox, confirm, input, select, Separator } from '@inquirer/prompts'
import type { BatchOperationResult, ThreadRecord } from '../../../src/shared/contracts'
import type { ThreadService } from '../../core/src/thread-service'
import {
  DEFAULT_FILTERS,
  filterThreads,
  groupThreads,
  resolveThreadSelection,
  type ArchiveFilter
} from '../../core/src/thread-utils'
import { operationSucceeded } from './output'

type Mutation = 'archive' | 'unarchive' | 'pin' | 'unpin' | 'delete'
type GroupMode = 'workspace' | 'directory'

interface InteractiveCopy {
  manager: string
  action: string
  search: string
  state: string
  spawned: string
  grouping: string
  refresh: string
  quit: string
  noTasks: string
  selectTasks: string
  typeDelete: string
  done(result: BatchOperationResult): string
}

function copy(language: string): InteractiveCopy {
  if (language === 'zh-CN') {
    return {
      manager: 'Threadbox 交互管理器',
      action: '选择操作',
      search: '搜索',
      state: '活动/归档筛选',
      spawned: '显示派生任务',
      grouping: '分组方式',
      refresh: '刷新',
      quit: '退出',
      noTasks: '当前筛选没有可操作任务。',
      selectTasks: '选择任务',
      typeDelete: '输入 DELETE 确认永久删除',
      done: (result) => `完成 ${result.succeeded.length}，失败 ${result.failed.length}，跳过 ${result.skipped.length}`
    }
  }
  return {
    manager: 'Threadbox interactive manager',
    action: 'Choose an action',
    search: 'Search',
    state: 'Active/archive filter',
    spawned: 'Show spawned tasks',
    grouping: 'Grouping',
    refresh: 'Refresh',
    quit: 'Quit',
    noTasks: 'No actionable tasks match the current filter.',
    selectTasks: 'Select tasks',
    typeDelete: 'Type DELETE to confirm permanent deletion',
    done: (result) => `Completed ${result.succeeded.length}, failed ${result.failed.length}, skipped ${result.skipped.length}`
  }
}

function eligible(thread: ThreadRecord, mutation: Mutation): boolean {
  if (thread.status === 'active') return false
  if (mutation === 'delete') return !thread.pinned
  if (mutation === 'archive') return !thread.archived
  if (mutation === 'unarchive') return thread.archived
  if (mutation === 'pin') return !thread.pinned
  return thread.pinned
}

function taskChoices(
  allThreads: ThreadRecord[],
  visible: ThreadRecord[],
  mutation: Mutation,
  showSpawned: boolean,
  groupMode: GroupMode
): Array<{ name: string; value: string; disabled?: string } | Separator> {
  const visibleIds = new Set(visible.map((thread) => thread.id))
  const choices: Array<{ name: string; value: string; disabled?: string } | Separator> = []
  const groups = groupMode === 'workspace'
    ? groupThreads(allThreads)
    : [...allThreads.reduce((directories, thread) => {
        const existing = directories.get(thread.cwd) ?? []
        existing.push(thread)
        directories.set(thread.cwd, existing)
        return directories
      }, new Map<string, ThreadRecord[]>()).entries()].map(([name, threads]) => ({
      id: name,
      name,
      kind: 'workspace' as const,
      threads
    }))
  for (const group of groups) {
    const groupThreadsVisible = group.threads.filter(
      (thread) => visibleIds.has(thread.id) && (showSpawned || !thread.internal)
    )
    if (groupThreadsVisible.length === 0) continue
    choices.push(new Separator(`-- ${group.name || 'Projectless'} --`))
    for (const thread of groupThreadsVisible) {
      const depth = thread.internal ? '  ' : ''
      const descendants = thread.descendantCount > 0 ? ` (+${thread.descendantCount})` : ''
      choices.push({
        name: `${depth}${thread.title}${descendants}  [${thread.source}]  ${thread.cwd}`,
        value: thread.id,
        disabled: eligible(thread, mutation) ? undefined : 'protected or already in that state'
      })
    }
  }
  return choices
}

async function mutate(
  service: ThreadService,
  mutation: Mutation,
  ids: string[]
): Promise<BatchOperationResult> {
  if (mutation === 'archive') return service.archiveThreads(ids)
  if (mutation === 'unarchive') return service.unarchiveThreads(ids)
  if (mutation === 'pin') return service.setPinned(ids, true)
  if (mutation === 'unpin') return service.setPinned(ids, false)
  return service.deleteThreads(ids, { trashWorkingDirectories: [] })
}

export async function runInteractive(service: ThreadService, language: string): Promise<number> {
  const t = copy(language)
  let query = ''
  let archive: ArchiveFilter = 'all'
  let showSpawned = false
  let groupMode: GroupMode = 'workspace'

  process.stdout.write(`${t.manager}\n`)
  for (;;) {
    const listed = await service.listThreads()
    const visible = filterThreads(listed.threads, { ...DEFAULT_FILTERS, query, archive })
    const action = await select<string>({
      message: t.action,
      choices: [
        { name: `Archive (${visible.filter((thread) => eligible(thread, 'archive')).length})`, value: 'archive' },
        { name: `Unarchive (${visible.filter((thread) => eligible(thread, 'unarchive')).length})`, value: 'unarchive' },
        { name: `Pin (${visible.filter((thread) => eligible(thread, 'pin')).length})`, value: 'pin' },
        { name: `Unpin (${visible.filter((thread) => eligible(thread, 'unpin')).length})`, value: 'unpin' },
        { name: `Delete (${visible.filter((thread) => eligible(thread, 'delete')).length})`, value: 'delete' },
        new Separator(),
        { name: `${t.search}: ${query || '*'}`, value: 'search' },
        { name: `${t.state}: ${archive}`, value: 'state' },
        { name: `${t.spawned}: ${showSpawned ? 'on' : 'off'}`, value: 'spawned' },
        { name: `${t.grouping}: ${groupMode}`, value: 'grouping' },
        { name: t.refresh, value: 'refresh' },
        { name: t.quit, value: 'quit' }
      ]
    })

    if (action === 'quit') return 0
    if (action === 'refresh') continue
    if (action === 'search') {
      query = await input({ message: t.search, default: query })
      continue
    }
    if (action === 'state') {
      archive = await select<ArchiveFilter>({
        message: t.state,
        choices: [
          { name: 'All', value: 'all' },
          { name: 'Active', value: 'active' },
          { name: 'Archived', value: 'archived' }
        ]
      })
      continue
    }
    if (action === 'spawned') {
      showSpawned = !showSpawned
      continue
    }
    if (action === 'grouping') {
      groupMode = groupMode === 'workspace' ? 'directory' : 'workspace'
      continue
    }

    const mutation = action as Mutation
    const choices = taskChoices(listed.threads, visible, mutation, showSpawned, groupMode)
    if (!choices.some((choice) => !(choice instanceof Separator) && !choice.disabled)) {
      process.stdout.write(`${t.noTasks}\n`)
      continue
    }
    const ids = await checkbox<string>({ message: t.selectTasks, choices, pageSize: 18 })
    if (ids.length === 0) continue
    const selection = resolveThreadSelection(listed.threads, ids)
    if (mutation === 'delete') {
      const confirmation = await input({ message: t.typeDelete })
      if (confirmation !== 'DELETE') continue
    } else if (!await confirm({ message: `${mutation} ${selection.effective.size} task(s)?`, default: false })) {
      continue
    }
    const result = await mutate(
      service,
      mutation,
      [...(mutation === 'delete' ? selection.roots : selection.effective)]
    )
    process.stdout.write(`${t.done(result)}\n`)
    if (!operationSucceeded(result)) {
      for (const failure of [...result.failed, ...result.skipped]) {
        process.stderr.write(`${failure.id}: ${failure.message}\n`)
      }
    }
  }
}
