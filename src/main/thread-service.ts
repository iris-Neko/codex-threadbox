import type { BatchOperationResult, ListThreadsResult, ThreadRecord } from '../shared/contracts'
import type { Thread } from '../shared/protocol/generated/v2/Thread'
import type { ThreadListResponse } from '../shared/protocol/generated/v2/ThreadListResponse'
import type { ThreadSourceKind } from '../shared/protocol/generated/v2/ThreadSourceKind'
import type { RpcClientLike } from './app-server-client'

const SOURCE_KINDS: ThreadSourceKind[] = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown'
]

interface InventoryEntry {
  thread: Thread
  archived: boolean
}

interface ExtendedThreadListParams {
  cursor?: string | null
  limit: number
  sortKey: 'updated_at'
  sortDirection: 'desc'
  sourceKinds: ThreadSourceKind[]
  archived: boolean
  useStateDbOnly: boolean
  isPinned?: boolean
}

type BatchMethod = 'thread/delete' | 'thread/archive' | 'thread/unarchive'

function sourceLabel(source: Thread['source']): string {
  if (typeof source === 'string') return source
  if ('custom' in source) return source.custom
  return 'subAgent'
}

function isInternal(thread: Thread): boolean {
  return typeof thread.source === 'object' && 'subAgent' in thread.source
}

function safeStatus(thread: Thread): ThreadRecord['status'] {
  const status = thread.status?.type
  return status === 'active' || status === 'idle' || status === 'notLoaded' || status === 'systemError'
    ? status
    : 'unknown'
}

function displayTitle(thread: Thread): string {
  const name = thread.name?.trim()
  if (name) return name
  const preview = thread.preview.trim().split(/\r?\n/, 1)[0]?.trim()
  return preview || thread.id
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ThreadService {
  private lastKnownDirectories = new Set<string>()
  private lastKnownThreadIds = new Set<string>()

  constructor(private readonly client: RpcClientLike) {}

  async listThreads(): Promise<ListThreadsResult> {
    const { entries, pinnedIds, environment } = await this.inventory()
    const children = this.buildChildren(entries)
    const records = entries.map(({ thread, archived }): ThreadRecord => {
      const status = safeStatus(thread)
      const pinned = pinnedIds.has(thread.id)
      return {
        id: thread.id,
        title: displayTitle(thread),
        preview: thread.preview,
        cwd: String(thread.cwd),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        source: sourceLabel(thread.source),
        archived,
        pinned,
        status,
        parentThreadId: thread.parentThreadId,
        descendantCount: this.descendantsOf(thread.id, children).size,
        internal: isInternal(thread),
        ineligibleReason: status === 'active' ? 'active' : pinned ? 'pinned' : null
      }
    })

    records.sort((left, right) => right.updatedAt - left.updatedAt)
    this.lastKnownDirectories = new Set(records.map((record) => record.cwd))
    this.lastKnownThreadIds = new Set(records.map((record) => record.id))
    return { threads: records, environment, refreshedAt: Date.now() }
  }

  async deleteThreads(ids: string[]): Promise<BatchOperationResult> {
    const requested = new Set(ids)
    const { entries, pinnedIds } = await this.inventory()
    const byId = new Map(entries.map((entry) => [entry.thread.id, entry]))
    const children = this.buildChildren(entries)
    const skipped: BatchOperationResult['skipped'] = []

    for (const id of requested) {
      const entry = byId.get(id)
      if (!entry) {
        skipped.push({ id, message: 'Thread was not found.' })
      } else if (safeStatus(entry.thread) === 'active') {
        skipped.push({ id, message: 'Active threads cannot be deleted.' })
      } else if (pinnedIds.has(id)) {
        skipped.push({ id, message: 'Pinned threads must be unpinned before deletion.' })
      }
    }

    const eligible = new Set(
      [...requested].filter((id) => byId.has(id) && !skipped.some((item) => item.id === id))
    )
    const roots = [...eligible].filter((id) => !this.hasSelectedAncestor(id, eligible, byId))
    const cascaded = new Set<string>()
    for (const root of roots) {
      for (const descendant of this.descendantsOf(root, children)) cascaded.add(descendant)
    }
    for (const root of roots) cascaded.delete(root)

    const result = await this.runBatch('thread/delete', roots)
    return {
      ...result,
      skipped,
      cascadedCount: cascaded.size,
      refreshedAt: Date.now()
    }
  }

  async archiveThreads(ids: string[]): Promise<BatchOperationResult> {
    return this.runStateBatch('thread/archive', ids, (entry) => !entry.archived)
  }

  async unarchiveThreads(ids: string[]): Promise<BatchOperationResult> {
    return this.runStateBatch('thread/unarchive', ids, (entry) => entry.archived)
  }

  async setPinned(ids: string[], pinned: boolean): Promise<BatchOperationResult> {
    const probe = await this.client.getProbe()
    if (!probe.status.capabilities.pinning) {
      return {
        succeeded: [],
        failed: ids.map((id) => ({
          id,
          message: 'Pinning requires a Codex CLI version that exposes the pinning API.'
        })),
        skipped: [],
        cascadedCount: 0,
        refreshedAt: Date.now()
      }
    }

    const succeeded: string[] = []
    const failed: BatchOperationResult['failed'] = []
    for (const id of ids) {
      try {
        await this.client.request('thread/metadata/update', { threadId: id, isPinned: pinned })
        succeeded.push(id)
      } catch (error) {
        failed.push({ id, message: errorMessage(error) })
      }
    }
    return { succeeded, failed, skipped: [], cascadedCount: 0, refreshedAt: Date.now() }
  }

  isKnownWorkingDirectory(path: string): boolean {
    return this.lastKnownDirectories.has(path)
  }

  isKnownThreadId(id: string): boolean {
    return this.lastKnownThreadIds.has(id)
  }

  private async inventory(): Promise<{
    entries: InventoryEntry[]
    pinnedIds: Set<string>
    environment: ListThreadsResult['environment']
  }> {
    const probe = await this.client.getProbe()
    if (probe.status.state !== 'ready') throw new Error(probe.status.message ?? 'Codex CLI is not ready.')

    const active = await this.fetchAll(false)
    const archived = await this.fetchAll(true)
    const merged = new Map<string, InventoryEntry>()
    for (const thread of active) merged.set(thread.id, { thread, archived: false })
    for (const thread of archived) merged.set(thread.id, { thread, archived: true })

    const pinnedIds = new Set<string>()
    if (probe.status.capabilities.pinning) {
      for (const thread of await this.fetchAll(false, true)) pinnedIds.add(thread.id)
      for (const thread of await this.fetchAll(true, true)) pinnedIds.add(thread.id)
    }

    probe.status.externalCodexProcesses = await this.client
      .getProbe(true)
      .then((latest) => latest.status.externalCodexProcesses)
    return { entries: [...merged.values()], pinnedIds, environment: probe.status }
  }

  private async fetchAll(archived: boolean, isPinned?: boolean): Promise<Thread[]> {
    const output: Thread[] = []
    let cursor: string | null = null
    do {
      const params: ExtendedThreadListParams = {
        cursor,
        limit: 100,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        sourceKinds: SOURCE_KINDS,
        archived,
        useStateDbOnly: false
      }
      if (isPinned !== undefined) params.isPinned = isPinned

      const page = await this.client.request<ThreadListResponse>('thread/list', params, 60_000)
      output.push(...page.data)
      cursor = page.nextCursor
    } while (cursor)
    return output
  }

  private async runStateBatch(
    method: Exclude<BatchMethod, 'thread/delete'>,
    ids: string[],
    matchesState: (entry: InventoryEntry) => boolean
  ): Promise<BatchOperationResult> {
    const { entries } = await this.inventory()
    const byId = new Map(entries.map((entry) => [entry.thread.id, entry]))
    const skipped: BatchOperationResult['skipped'] = []
    const eligible: string[] = []
    for (const id of ids) {
      const entry = byId.get(id)
      if (!entry) skipped.push({ id, message: 'Thread was not found.' })
      else if (safeStatus(entry.thread) === 'active') {
        skipped.push({ id, message: 'Active threads cannot be changed.' })
      } else if (!matchesState(entry)) skipped.push({ id, message: 'Thread is already in that state.' })
      else eligible.push(id)
    }

    const result = await this.runBatch(method, eligible)
    return { ...result, skipped, cascadedCount: 0, refreshedAt: Date.now() }
  }

  private async runBatch(method: BatchMethod, ids: string[]): Promise<{
    succeeded: string[]
    failed: BatchOperationResult['failed']
    skipped: BatchOperationResult['skipped']
    cascadedCount: number
    refreshedAt: number
  }> {
    const succeeded: string[] = []
    const failed: BatchOperationResult['failed'] = []
    for (const id of ids) {
      try {
        await this.client.request(method, { threadId: id })
        succeeded.push(id)
      } catch (error) {
        failed.push({ id, message: errorMessage(error) })
      }
    }
    return { succeeded, failed, skipped: [], cascadedCount: 0, refreshedAt: Date.now() }
  }

  private buildChildren(entries: InventoryEntry[]): Map<string, string[]> {
    const children = new Map<string, string[]>()
    for (const { thread } of entries) {
      if (!thread.parentThreadId) continue
      const siblings = children.get(thread.parentThreadId) ?? []
      siblings.push(thread.id)
      children.set(thread.parentThreadId, siblings)
    }
    return children
  }

  private descendantsOf(id: string, children: Map<string, string[]>): Set<string> {
    const descendants = new Set<string>()
    const queue = [...(children.get(id) ?? [])]
    while (queue.length > 0) {
      const child = queue.shift()
      if (!child || descendants.has(child)) continue
      descendants.add(child)
      queue.push(...(children.get(child) ?? []))
    }
    return descendants
  }

  private hasSelectedAncestor(
    id: string,
    selected: Set<string>,
    byId: Map<string, InventoryEntry>
  ): boolean {
    const visited = new Set<string>()
    let parent = byId.get(id)?.thread.parentThreadId ?? null
    while (parent && !visited.has(parent)) {
      if (selected.has(parent)) return true
      visited.add(parent)
      parent = byId.get(parent)?.thread.parentThreadId ?? null
    }
    return false
  }
}
