// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../../src/shared/contracts'
import type { RpcClientLike } from '../../packages/core/src/app-server-client'
import {
  chooseProjectDirectory,
  createProjectThread
} from '../../packages/vscode/src/codex-projects'

class FakeClient implements RpcClientLike {
  readonly calls: Array<{ method: string; params: unknown }> = []
  responses = new Map<string, unknown[]>()
  failures = new Map<string, Error>()

  async request<T>(method: string, params: unknown = {}): Promise<T> {
    this.calls.push({ method, params })
    const failure = this.failures.get(method)
    if (failure) throw failure
    const responses = this.responses.get(method) ?? []
    if (responses.length === 0) return {} as T
    return responses.shift() as T
  }

  getProbe(): never { throw new Error('not used') }
  restart(): Promise<void> { return Promise.resolve() }
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'threadbox:one',
    name: 'One',
    kind: 'threadbox',
    readOnly: false,
    codexProjectId: null,
    roots: ['/work/app'],
    canCreateThread: true,
    createThreadUnavailableReason: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

function started(threadId = 'thread-new'): unknown {
  return { thread: { id: threadId, historyMode: 'legacy' } }
}

function persisted(threadId: string, name: string): unknown {
  return { thread: { id: threadId, name, ephemeral: false, historyMode: 'legacy' } }
}

describe('VS Code Codex projects', () => {
  it('chooses the only root, prompts for multiple roots, and browses empty projects', async () => {
    const pickRoot = vi.fn(async () => '/work/two')
    const pickFolder = vi.fn(async () => '/chosen')
    await expect(chooseProjectDirectory(project(), { pickRoot, pickFolder }))
      .resolves.toBe('/work/app')
    expect(pickRoot).not.toHaveBeenCalled()
    expect(pickFolder).not.toHaveBeenCalled()

    await expect(chooseProjectDirectory(project({ roots: ['/work/one', '/work/two'] }), {
      pickRoot,
      pickFolder
    })).resolves.toBe('/work/two')
    expect(pickRoot).toHaveBeenCalledWith(['/work/one', '/work/two'])

    await expect(chooseProjectDirectory(project({ roots: [] }), { pickRoot, pickFolder }))
      .resolves.toBe('/chosen')
  })

  it('does not create a task when directory selection is cancelled', async () => {
    const picker = {
      pickRoot: vi.fn(async () => null),
      pickFolder: vi.fn(async () => null)
    }
    await expect(chooseProjectDirectory(project({ roots: ['/one', '/two'] }), picker))
      .resolves.toBeNull()
    await expect(chooseProjectDirectory(project({ roots: [] }), picker)).resolves.toBeNull()
  })

  it('creates and names a blank task before assigning a Threadbox project', async () => {
    const client = new FakeClient()
    client.responses.set('thread/start', [started()])
    client.responses.set('thread/read', [persisted('thread-new', 'New task')])
    const assign = vi.fn(async () => undefined)

    await expect(createProjectThread(client, project(), '  New task  ', '/work/app', assign))
      .resolves.toMatchObject({ threadId: 'thread-new', name: 'New task' })
    expect(client.calls).toEqual([
      { method: 'thread/start', params: { cwd: '/work/app', historyMode: 'legacy' } },
      { method: 'thread/name/set', params: { threadId: 'thread-new', name: 'New task' } },
      { method: 'thread/read', params: { threadId: 'thread-new', includeTurns: false } },
      { method: 'thread/unsubscribe', params: { threadId: 'thread-new' } }
    ])
    expect(assign).toHaveBeenCalledWith('thread-new', 'threadbox:one')
  })

  it('rejects non-Threadbox projects before starting a task', async () => {
    const client = new FakeClient()
    const assign = vi.fn(async () => undefined)
    const official = project({
      id: 'official:codex-one',
      kind: 'official',
      readOnly: true,
      codexProjectId: 'codex-one'
    })

    await expect(createProjectThread(client, official, 'Official task', '/work/app', assign))
      .rejects.toThrow(/Only Threadbox projects/)
    expect(client.calls).toEqual([])
    expect(assign).not.toHaveBeenCalled()
  })

  it('removes the new task when naming or local assignment fails', async () => {
    const namingClient = new FakeClient()
    namingClient.responses.set('thread/start', [started('name-failed')])
    namingClient.failures.set('thread/name/set', new Error('name failed'))
    await expect(createProjectThread(
      namingClient, project(), 'Name', '/work/app', async () => undefined
    )).rejects.toThrow('name failed')
    expect(namingClient.calls.slice(-2)).toEqual([
      { method: 'thread/delete', params: { threadId: 'name-failed' } },
      { method: 'thread/unsubscribe', params: { threadId: 'name-failed' } }
    ])

    const assignmentClient = new FakeClient()
    assignmentClient.responses.set('thread/start', [started('assign-failed')])
    assignmentClient.responses.set('thread/read', [persisted('assign-failed', 'Name')])
    await expect(createProjectThread(
      assignmentClient,
      project(),
      'Name',
      '/work/app',
      async () => { throw new Error('assignment failed') }
    )).rejects.toThrow('assignment failed')
    expect(assignmentClient.calls.slice(-2)).toEqual([
      { method: 'thread/delete', params: { threadId: 'assign-failed' } },
      { method: 'thread/unsubscribe', params: { threadId: 'assign-failed' } }
    ])

    const verificationClient = new FakeClient()
    verificationClient.responses.set('thread/start', [started('verify-failed')])
    verificationClient.failures.set('thread/read', new Error('task was not persisted'))
    await expect(createProjectThread(
      verificationClient, project(), 'Name', '/work/app', async () => undefined
    )).rejects.toThrow('task was not persisted')
    expect(verificationClient.calls.slice(-2)).toEqual([
      { method: 'thread/delete', params: { threadId: 'verify-failed' } },
      { method: 'thread/unsubscribe', params: { threadId: 'verify-failed' } }
    ])
  })

  it('removes a task that Codex creates with non-resumable history', async () => {
    const client = new FakeClient()
    client.responses.set('thread/start', [{
      thread: { id: 'paginated-task', historyMode: 'paginated' }
    }])

    await expect(createProjectThread(
      client, project(), 'Name', '/work/app', async () => undefined
    )).rejects.toThrow(/resumable history/)
    expect(client.calls).toEqual([
      { method: 'thread/start', params: { cwd: '/work/app', historyMode: 'legacy' } },
      { method: 'thread/delete', params: { threadId: 'paginated-task' } },
      { method: 'thread/unsubscribe', params: { threadId: 'paginated-task' } }
    ])
  })

  it('keeps a persisted task when unsubscribe fails because the host closes its client', async () => {
    const client = new FakeClient()
    client.responses.set('thread/start', [started()])
    client.responses.set('thread/read', [persisted('thread-new', 'New task')])
    client.failures.set('thread/unsubscribe', new Error('unsubscribe failed'))

    await expect(createProjectThread(
      client, project(), 'New task', '/work/app', async () => undefined
    )).resolves.toMatchObject({ threadId: 'thread-new' })
    expect(client.calls.at(-1)).toEqual({
      method: 'thread/unsubscribe', params: { threadId: 'thread-new' }
    })
    expect(client.calls.some((call) => call.method === 'thread/delete')).toBe(false)
  })

  it('reports the task ID when rollback also fails', async () => {
    const client = new FakeClient()
    client.responses.set('thread/start', [started('orphan-id')])
    client.failures.set('thread/name/set', new Error('name failed'))
    client.failures.set('thread/delete', new Error('delete failed'))
    await expect(createProjectThread(client, project(), 'Name', '/work/app', async () => undefined))
      .rejects.toThrow(/orphan-id.*delete failed/)
  })

  it('rejects invalid task names before starting a task', async () => {
    const client = new FakeClient()
    await expect(createProjectThread(client, project(), 'bad\nname', '/work/app', async () => undefined))
      .rejects.toThrow(/visible characters/)
    await expect(createProjectThread(client, project(), 'x'.repeat(513), '/work/app', async () => undefined))
      .rejects.toThrow(/visible characters/)
    expect(client.calls).toEqual([])
  })

})
