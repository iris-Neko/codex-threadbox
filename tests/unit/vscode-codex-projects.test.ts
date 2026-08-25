// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../../src/shared/contracts'
import type { Project } from '../../src/shared/protocol/generated/v2/Project'
import type { RpcClientLike } from '../../packages/core/src/app-server-client'
import {
  chooseOfficialProjectRoots,
  chooseProjectDirectory,
  createCodexProject,
  createProjectThread,
  deleteCodexProject,
  listCodexProjects,
  renameCodexProject
} from '../../packages/vscode/src/codex-projects'
import type { ProjectRootsPicker } from '../../packages/vscode/src/codex-projects'

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

function codexProject(id: string, roots: string[] = ['/work/app']): Project {
  return {
    id,
    name: `Project ${id}`,
    roots: roots.map((path) => ({ path })),
    metadata: {},
    position: 0,
    createdAt: 1,
    updatedAt: 2
  }
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
  return { thread: { id: threadId } }
}

describe('VS Code Codex projects', () => {
  it('lists every official project page', async () => {
    const client = new FakeClient()
    client.responses.set('project/list', [
      { data: [codexProject('one')], nextCursor: 'page-2' },
      { data: [codexProject('two')], nextCursor: null }
    ])

    const catalog = await listCodexProjects(client)
    expect(catalog.available).toBe(true)
    expect(catalog.projects.map((item) => item.id)).toEqual(['one', 'two'])
    expect(client.calls.map((call) => call.params)).toEqual([
      { cursor: null, limit: 100 },
      { cursor: 'page-2', limit: 100 }
    ])
  })

  it('keeps official project discovery failure non-fatal', async () => {
    const client = new FakeClient()
    client.failures.set('project/list', new Error('Method not found'))
    await expect(listCodexProjects(client)).resolves.toMatchObject({
      available: false,
      projects: [],
      message: expect.stringContaining('Method not found')
    })
  })

  it('creates, renames, and deletes official Codex projects', async () => {
    const client = new FakeClient()
    client.responses.set('project/create', [{ project: codexProject('created', ['/one', '/two']) }])
    client.responses.set('project/update', [{ project: { ...codexProject('created'), name: 'Renamed' } }])

    await expect(createCodexProject(client, ' New project ', ['/one', '/two']))
      .resolves.toMatchObject({ id: 'created' })
    await expect(renameCodexProject(client, 'created', ' Renamed '))
      .resolves.toMatchObject({ name: 'Renamed' })
    await expect(deleteCodexProject(client, 'created')).resolves.toBeUndefined()
    expect(client.calls).toEqual([
      {
        method: 'project/create',
        params: {
          name: 'New project',
          roots: [{ path: '/one' }, { path: '/two' }],
          idempotencyKey: expect.any(String)
        }
      },
      { method: 'project/update', params: { projectId: 'created', name: 'Renamed' } },
      { method: 'project/delete', params: { projectId: 'created' } }
    ])
  })

  it('chooses official project roots without touching Codex when cancelled', async () => {
    const picker: ProjectRootsPicker = {
      pickWorkspaceRoots: vi.fn(async () => ['/two']),
      pickFolders: vi.fn(async () => ['/chosen'])
    }
    await expect(chooseOfficialProjectRoots(['/one'], picker)).resolves.toEqual(['/one'])
    await expect(chooseOfficialProjectRoots(['/one', '/two'], picker)).resolves.toEqual(['/two'])
    await expect(chooseOfficialProjectRoots([], picker)).resolves.toEqual(['/chosen'])

    await expect(chooseOfficialProjectRoots(['/one', '/two'], {
      ...picker,
      pickWorkspaceRoots: vi.fn(async () => null)
    })).resolves.toBeNull()
    await expect(chooseOfficialProjectRoots([], {
      ...picker,
      pickFolders: vi.fn(async () => null)
    })).resolves.toBeNull()
  })

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
    const assign = vi.fn(async () => undefined)

    await expect(createProjectThread(client, project(), '  New task  ', '/work/app', assign))
      .resolves.toMatchObject({ threadId: 'thread-new', name: 'New task' })
    expect(client.calls).toEqual([
      { method: 'thread/start', params: { cwd: '/work/app' } },
      { method: 'thread/name/set', params: { threadId: 'thread-new', name: 'New task' } }
    ])
    expect(assign).toHaveBeenCalledWith('thread-new', 'threadbox:one')
  })

  it('creates a blank task directly in an official project', async () => {
    const client = new FakeClient()
    client.responses.set('thread/start', [started('official-thread')])
    const assign = vi.fn(async () => undefined)
    const official = project({
      id: 'official:codex-one',
      kind: 'official',
      readOnly: true,
      codexProjectId: 'codex-one'
    })

    await createProjectThread(client, official, 'Official task', '/work/app', assign)
    expect(client.calls[0]).toEqual({
      method: 'thread/start',
      params: { cwd: '/work/app', projectId: 'codex-one' }
    })
    expect(assign).not.toHaveBeenCalled()
  })

  it('removes the new task when naming or local assignment fails', async () => {
    const namingClient = new FakeClient()
    namingClient.responses.set('thread/start', [started('name-failed')])
    namingClient.failures.set('thread/name/set', new Error('name failed'))
    await expect(createProjectThread(
      namingClient, project(), 'Name', '/work/app', async () => undefined
    )).rejects.toThrow('name failed')
    expect(namingClient.calls.at(-1)).toEqual({
      method: 'thread/delete', params: { threadId: 'name-failed' }
    })

    const assignmentClient = new FakeClient()
    assignmentClient.responses.set('thread/start', [started('assign-failed')])
    await expect(createProjectThread(
      assignmentClient,
      project(),
      'Name',
      '/work/app',
      async () => { throw new Error('assignment failed') }
    )).rejects.toThrow('assignment failed')
    expect(assignmentClient.calls.at(-1)).toEqual({
      method: 'thread/delete', params: { threadId: 'assign-failed' }
    })
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

  it('rejects invalid official project input before calling Codex', async () => {
    const client = new FakeClient()
    await expect(createCodexProject(client, ' ', ['/work'])).rejects.toThrow(/visible characters/)
    await expect(createCodexProject(client, 'Project', [])).rejects.toThrow(/project root/)
    await expect(renameCodexProject(client, '', 'Name')).rejects.toThrow(/project ID/)
    expect(client.calls).toEqual([])
  })
})
