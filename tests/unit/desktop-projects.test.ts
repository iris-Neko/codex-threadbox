// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopProjects } from '../../src/main/desktop-projects'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'threadbox-projects-')) })
afterEach(async () => { await rm(home, { recursive: true, force: true }) })
const record = (id: string, name = id) => ({ id, name, createdAt: 1, updatedAt: 2, roots: [{ path: '/work' }] })
const client = () => ({ request: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) })

async function legacy(extra: Record<string, unknown> = {}): Promise<string> {
  const value = JSON.stringify({
    'local-projects': { old: { id: 'old', name: 'Old name', rootPaths: ['/work'] } },
    'thread-project-assignments': { root: { projectKind: 'local', projectId: 'old' } },
    'app-server-project-id-by-legacy-project-id-by-host': { [`local:${home}`]: { old: 'new' } },
    ...extra
  })
  await writeFile(join(home, '.codex-global-state.json'), value)
  return value
}

describe('DesktopProjects read-only adapter', () => {
  it('reads paginated official names and fills only explicit legacy assignments without writes', async () => {
    const before = await legacy({ 'unrelated-private-state': { ignored: 'not forwarded' } })
    const rpc = client()
    rpc.request.mockResolvedValueOnce({ data: [record('new', 'Real project name')], nextCursor: 'page-2', extra: true })
      .mockResolvedValueOnce({ data: [record('empty', 'Empty project')] })
    const result = await new DesktopProjects(rpc, home).list()
    expect(result.projects.map((item) => item.name)).toEqual(['Real project name', 'Empty project'])
    expect(result.assignments).toEqual({ root: 'official:new' })
    expect(result.projects.every((item) => item.readOnly && item.kind === 'official')).toBe(true)
    expect(rpc.request.mock.calls.map((call) => call[0])).toEqual(['project/list', 'project/list'])
    expect(rpc.request.mock.calls[1]?.[1]).toMatchObject({ cursor: 'page-2' })
    expect(JSON.stringify(result)).not.toContain('not forwarded')
    expect(await readFile(join(home, '.codex-global-state.json'), 'utf8')).toBe(before)
  })
  it('falls back on old servers without treating directories as projects', async () => {
    await legacy({ 'app-server-project-id-by-legacy-project-id-by-host': {}, 'electron-saved-workspace-roots': ['/not-a-project'] })
    const rpc = client()
    rpc.request.mockRejectedValue(new Error('unknown variant `project/list`'))
    const result = await new DesktopProjects(rpc, home).list()
    expect(result.projects.map((item) => item.name)).toEqual(['Old name'])
    expect(result.assignments).toEqual({ root: 'official:desktop:old' })
  })
  it('excludes remote and projectless assignments and honors completed migration', async () => {
    await legacy({
      'thread-project-assignments': {
        root: { projectKind: 'local', projectId: 'old' },
        remote: { projectKind: 'remote', projectId: 'old' },
        removed: { projectKind: 'local', projectId: 'old' }
      },
      'projectless-thread-ids': ['removed']
    })
    const rpc = client()
    rpc.request.mockResolvedValue({ data: [record('new')] })
    expect((await new DesktopProjects(rpc, home).list()).assignments).toEqual({ root: 'official:new' })
    await legacy({ 'app-server-projects-migration-by-host': { [`local:${home}`]: { threadAssignmentsMigrated: true } } })
    expect((await new DesktopProjects(rpc, home).list()).assignments).toEqual({})
  })
  it('does not resurrect an already migrated project deleted from the server', async () => {
    await legacy()
    const result = await new DesktopProjects(client(), home).list()
    expect(result.projects).toEqual([])
    expect(result.assignments).toEqual({})
  })
  it('reports unreadable data or RPC failures instead of silently claiming no projects', async () => {
    const rpc = client()
    rpc.request.mockRejectedValue(new Error('Disconnected'))
    await expect(new DesktopProjects(rpc, home).list()).rejects.toThrow('Disconnected')
    await writeFile(join(home, '.codex-global-state.json'), '{invalid')
    await expect(new DesktopProjects(rpc, home).list()).rejects.toThrow('Could not read')
    expect(await readFile(join(home, '.codex-global-state.json'), 'utf8')).toBe('{invalid')
  })
  it('accepts missing metadata and unknown fields but rejects invalid and looping pages', async () => {
    const rpc = client()
    expect((await new DesktopProjects(rpc, home).list()).projects).toEqual([])
    rpc.request.mockResolvedValue({ notData: [] })
    await expect(new DesktopProjects(rpc, home).list()).rejects.toThrow('invalid project list')
    rpc.request.mockResolvedValue({ data: [], nextCursor: 'repeat' })
    await expect(new DesktopProjects(rpc, home).list()).rejects.toThrow('repeated')
  })
})
