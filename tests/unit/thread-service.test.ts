import { describe, expect, it } from 'vitest'
import type { RpcClientLike } from '../../packages/core/src/app-server-client'
import type { WorkingDirectoryCleanerLike } from '../../packages/core/src/directory-cleaner'
import { ThreadService } from '../../packages/core/src/thread-service'
import type { EnvironmentStatus } from '../../src/shared/contracts'
import type { Thread } from '../../src/shared/protocol/generated/v2/Thread'

const ready: EnvironmentStatus = {
  state: 'ready',
  cliPath: 'codex',
  cliVersion: '0.150.0',
  minimumVersion: '0.149.0',
  message: null,
  externalCodexProcesses: 0,
  capabilities: { pinning: true }
}

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: `Preview ${id}`,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    modelProvider: 'openai',
    createdAt: 100,
    updatedAt: 200,
    recencyAt: 200,
    status: { type: 'notLoaded' },
    path: null,
    cwd: '/workspace',
    cliVersion: '0.150.0',
    source: 'cli',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides
  }
}

class FakeClient implements RpcClientLike {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = []
  failDeleteId: string | null = null

  constructor(
    private readonly active: Thread[],
    private readonly archived: Thread[],
    private readonly pinned: Set<string> = new Set(),
    private readonly environment: EnvironmentStatus = ready
  ) {}

  async request<T>(method: string, rawParams: unknown = {}): Promise<T> {
    const params = rawParams as Record<string, unknown>
    this.calls.push({ method, params })
    if (method === 'thread/list') {
      const source = params.archived ? this.archived : this.active
      const data = params.isPinned ? source.filter((item) => this.pinned.has(item.id)) : source
      return { data, nextCursor: null, backwardsCursor: null } as T
    }
    if (method === 'thread/delete' && params.threadId === this.failDeleteId) {
      throw new Error('delete failed')
    }
    return {} as T
  }

  async getProbe(): Promise<{ command: string; status: EnvironmentStatus }> {
    return { command: 'codex', status: structuredClone(this.environment) }
  }

  async restart(): Promise<void> {}
}

class FakeDirectoryCleaner implements WorkingDirectoryCleanerLike {
  readonly calls: string[][] = []

  async cleanup(paths: string[]) {
    this.calls.push(paths)
    return { requested: paths, trashed: paths, failed: [], skipped: [] }
  }
}

describe('ThreadService', () => {
  it('follows pagination cursors until all pages are loaded', async () => {
    const pages = [thread('first'), thread('second')]
    let activeCalls = 0
    const client: RpcClientLike = {
      getProbe: async () => ({
        command: 'codex',
        status: { ...ready, capabilities: { pinning: false } }
      }),
      restart: async () => undefined,
      request: async <T,>(method: string, rawParams: unknown = {}) => {
        const params = rawParams as Record<string, unknown>
        if (method !== 'thread/list' || params.archived) {
          return { data: [], nextCursor: null, backwardsCursor: null } as T
        }
        const index = params.cursor ? 1 : 0
        activeCalls += 1
        return {
          data: [pages[index]],
          nextCursor: index === 0 ? 'next-page' : null,
          backwardsCursor: null
        } as T
      }
    }

    const result = await new ThreadService(client).listThreads()
    expect(result.threads.map((item) => item.id).toSorted()).toEqual(['first', 'second'])
    expect(activeCalls).toBe(2)
  })

  it('merges active and archived tasks and calculates descendants', async () => {
    const parent = thread('parent', { name: 'Parent', projectId: 'project-one' })
    const child = thread('child', {
      parentThreadId: 'parent',
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: 'parent',
            depth: 1,
            agent_path: null,
            agent_nickname: null,
            agent_role: null
          }
        }
      }
    })
    const archived = thread('archived')
    const service = new ThreadService(new FakeClient([parent, child], [archived]))

    const result = await service.listThreads()
    expect(result.threads).toHaveLength(3)
    expect(result.threads.find((item) => item.id === 'parent')).toMatchObject({
      title: 'Parent',
      projectId: 'project-one',
      descendantCount: 1,
      archived: false
    })
    expect(result.threads.find((item) => item.id === 'child')).toMatchObject({
      internal: true,
      source: 'subAgentThreadSpawn'
    })
    expect(result.threads.find((item) => item.id === 'archived')?.archived).toBe(true)
  })

  it('classifies system and user-spawned subagent sources', async () => {
    const spawned = thread('spawned', {
      source: { subAgent: { thread_spawn: {
        parent_thread_id: 'parent', depth: 1, agent_path: null,
        agent_nickname: null, agent_role: null
      } } }
    })
    const review = thread('review', { source: { subAgent: 'review' } })
    const compact = thread('compact', { source: { subAgent: 'compact' } })
    const guardian = thread('guardian', { source: { subAgent: { other: 'guardian' } } })

    const result = await new ThreadService(
      new FakeClient([spawned, review, compact, guardian], [])
    ).listThreads()
    expect(Object.fromEntries(result.threads.map((item) => [item.id, item.source]))).toEqual({
      spawned: 'subAgentThreadSpawn',
      review: 'subAgentReview',
      compact: 'subAgentCompact',
      guardian: 'subAgentOther'
    })
  })

  it('deduplicates selected descendants and skips protected tasks', async () => {
    const parent = thread('parent')
    const child = thread('child', { parentThreadId: 'parent' })
    const active = thread('active', { status: { type: 'active', activeFlags: [] } })
    const pinned = thread('pinned')
    const client = new FakeClient([parent, child, active, pinned], [], new Set(['pinned']))
    const service = new ThreadService(client)

    const result = await service.deleteThreads(['parent', 'child', 'active', 'pinned'])
    expect(result.succeeded).toEqual(['parent'])
    expect(result.cascadedCount).toBe(1)
    expect(result.skipped.map((item) => item.id).toSorted()).toEqual(['active', 'pinned'])
    expect(
      client.calls.filter((call) => call.method === 'thread/delete').map((call) => call.params.threadId)
    ).toEqual(['parent'])
  })

  it('previews root deletion and blocks a parent with a protected descendant', async () => {
    const parent = thread('parent', { name: 'Parent task', cwd: '/workspace/parent' })
    const child = thread('child', {
      parentThreadId: 'parent',
      status: { type: 'active', activeFlags: [] }
    })
    const client = new FakeClient([parent, child], [])
    const service = new ThreadService(client)

    const preview = await service.previewDeleteThreads(['parent', 'child', 'missing'])
    expect(preview.requestedIds).toEqual(['parent', 'child', 'missing'])
    expect(preview.roots).toEqual([])
    expect(preview.skipped.map((item) => item.id).toSorted()).toEqual(['child', 'missing', 'parent'])
    expect(client.calls.some((call) => call.method === 'thread/delete')).toBe(false)
  })

  it('revalidates protected descendants after a deletion preview', async () => {
    const parent = thread('parent', { name: 'Parent task' })
    const child = thread('child', { parentThreadId: 'parent' })
    const client = new FakeClient([parent, child], [])
    const service = new ThreadService(client)

    const preview = await service.previewDeleteThreads(['parent'])
    expect(preview.roots.map((item) => item.id)).toEqual(['parent'])
    expect(preview.cascadedCount).toBe(1)

    child.status = { type: 'active', activeFlags: [] }
    const result = await service.deleteThreads(['parent'])
    expect(result.succeeded).toEqual([])
    expect(result.skipped).toEqual([
      { id: 'parent', message: 'A spawned descendant (child) is active or pinned.' }
    ])
    expect(client.calls.some((call) => call.method === 'thread/delete')).toBe(false)
  })

  it('continues a batch after an individual failure', async () => {
    const client = new FakeClient([thread('one'), thread('two')], [])
    client.failDeleteId = 'one'
    const service = new ThreadService(client)

    const result = await service.deleteThreads(['one', 'two'])
    expect(result.failed).toEqual([{ id: 'one', message: 'delete failed' }])
    expect(result.succeeded).toEqual(['two'])
  })

  it('moves only explicitly selected directories after their tasks are deleted', async () => {
    const cleaner = new FakeDirectoryCleaner()
    const client = new FakeClient(
      [thread('keep', { cwd: '/workspace/keep' }), thread('trash', { cwd: '/workspace/trash' })],
      []
    )
    const service = new ThreadService(client, cleaner)

    const result = await service.deleteThreads(['keep', 'trash'], {
      trashWorkingDirectories: ['/workspace/trash']
    })

    expect(cleaner.calls).toEqual([['/workspace/trash']])
    expect(result.directoryCleanup?.trashed).toEqual(['/workspace/trash'])
  })

  it('keeps a directory when another remaining task still uses it', async () => {
    const cleaner = new FakeDirectoryCleaner()
    const client = new FakeClient(
      [thread('delete', { cwd: '/workspace/shared' }), thread('remain', { cwd: '/workspace/shared' })],
      []
    )
    const service = new ThreadService(client, cleaner)

    const result = await service.deleteThreads(['delete'], {
      trashWorkingDirectories: ['/workspace/shared']
    })

    expect(cleaner.calls).toHaveLength(0)
    expect(result.directoryCleanup?.skipped[0]?.message).toMatch(/remaining Codex task/)
  })

  it('keeps a directory when its task deletion fails', async () => {
    const cleaner = new FakeDirectoryCleaner()
    const client = new FakeClient([thread('failed', { cwd: '/workspace/failed' })], [])
    client.failDeleteId = 'failed'
    const service = new ThreadService(client, cleaner)

    const result = await service.deleteThreads(['failed'], {
      trashWorkingDirectories: ['/workspace/failed']
    })

    expect(cleaner.calls).toHaveLength(0)
    expect(result.directoryCleanup?.skipped[0]?.message).toMatch(/did not succeed/)
  })

  it('reports pinning as unsupported without sending a mutation', async () => {
    const environment = { ...ready, cliVersion: '0.149.0', capabilities: { pinning: false } }
    const client = new FakeClient([thread('one')], [], new Set(), environment)
    const service = new ThreadService(client)

    const result = await service.setPinned(['one'], true)
    expect(result.failed).toHaveLength(1)
    expect(client.calls.some((call) => call.method === 'thread/metadata/update')).toBe(false)
  })
})
