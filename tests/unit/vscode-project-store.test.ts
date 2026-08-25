// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../../packages/vscode/src/project-store'
import type { ThreadRecord } from '../../src/shared/contracts'

const temporaryDirectories: string[] = []

function record(overrides: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'root', title: 'Root', preview: '', cwd: '/work/app', projectId: null,
    createdAt: 1, updatedAt: 2, source: 'vscode', archived: false, pinned: false,
    status: 'idle', parentThreadId: null, descendantCount: 0, internal: false,
    ineligibleReason: null, ...overrides
  }
}

async function setup(): Promise<{ directory: string; path: string; store: ProjectStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'threadbox-projects-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'projects-v1.json')
  return { directory, path, store: new ProjectStore(path) }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  ))
})

describe('VS Code project store', () => {
  it('creates, renames and persists unique projects', async () => {
    const { path, store } = await setup()
    const created = await store.create('Release')
    const project = created.projects.find((item) => item.name === 'Release')!
    expect(project).toMatchObject({ name: 'Release', kind: 'threadbox', readOnly: false })
    await expect(store.create(' release ')).rejects.toThrow(/already exists/)

    const renamed = await store.renameProject(project.id, 'Launch')
    expect(renamed.projects.some((item) => item.name === 'Launch')).toBe(true)
    const reloaded = new ProjectStore(path)
    expect((await reloaded.list()).projects.some((item) => item.name === 'Launch')).toBe(true)
  })

  it('serializes concurrent project writes', async () => {
    const { path, store } = await setup()
    await Promise.all([store.create('Alpha'), store.create('Beta')])
    const names = (await new ProjectStore(path).list()).projects
      .filter((project) => project.systemKind !== 'trash')
      .map((project) => project.name).toSorted()
    expect(names).toEqual(['Alpha', 'Beta'])
  })

  it('assigns parent and child selections to the root task', async () => {
    const { store } = await setup()
    const root = record({ id: 'root', descendantCount: 1 })
    const child = record({ id: 'child', parentThreadId: 'root', internal: true })
    await store.setInventory([root, child])
    const project = (await store.create('Focus')).projects.find((item) => item.name === 'Focus')!

    const assigned = await store.assign(['child'], project.id)
    expect(assigned.assignments).toEqual({ root: project.id })
    expect(assigned.projects.find((item) => item.id === project.id)?.roots).toEqual(['/work/app'])
    expect((await store.assign(['root', 'child'], null)).assignments).toEqual({})
  })

  it('assigns a newly created blank task without requiring a refreshed inventory', async () => {
    const { store } = await setup()
    const project = (await store.create('Focus')).projects.find((item) => item.name === 'Focus')!
    await store.assignCreatedThread('new-thread', project.id)
    expect((await store.list()).assignments).toEqual({ 'new-thread': project.id })
  })

  it('uses official project names and roots from the Codex project catalog', async () => {
    const { store } = await setup()
    const snapshot = await store.setInventory([], {
      available: true,
      message: null,
      projects: [{
        id: 'codex-project',
        name: 'Official Product',
        roots: [{ path: '/work/product' }, { path: '/work/docs' }],
        metadata: {},
        position: 0,
        createdAt: 1,
        updatedAt: 2
      }]
    })
    expect(snapshot.projects).toContainEqual(expect.objectContaining({
      id: 'official:codex-project',
      name: 'Official Product',
      codexProjectId: 'codex-project',
      roots: ['/work/product', '/work/docs'],
      canCreateThread: true,
      readOnly: false
    }))
    expect(snapshot.canManageOfficialProjects).toBe(true)
    expect(snapshot.officialProjectManagementUnavailableReason).toBeNull()
  })

  it('removes project assignments without changing the inventory', async () => {
    const { store } = await setup()
    const task = record({ id: 'task' })
    await store.setInventory([task])
    const project = (await store.create('Temporary')).projects.find((item) => item.name === 'Temporary')!
    await store.assign(['task'], project.id)

    const deleted = await store.deleteProject(project.id)
    expect(deleted.projects.filter((item) => item.systemKind !== 'trash')).toEqual([])
    expect(deleted.assignments).toEqual({})
    await expect(store.assign(['task'], project.id)).rejects.toThrow(/not found/)
  })

  it('prunes missing tasks and preserves official project metadata ownership', async () => {
    const { store } = await setup()
    const official = record({ id: 'official-task', projectId: 'codex-project', cwd: '/work/product' })
    await store.setInventory([official])
    const project = (await store.create('Keep')).projects.find((item) => item.name === 'Keep')!
    await store.assign(['official-task'], project.id)
    const pruned = await store.setInventory([])
    expect(pruned.assignments).toEqual({})

    const restored = await store.setInventory([official])
    expect(restored.projects.find((item) => item.kind === 'official')).toMatchObject({
      id: 'official:codex-project', name: 'product', readOnly: true, canCreateThread: false
    })
    expect(restored.canManageOfficialProjects).toBe(false)
  })

  it('backs up a corrupt file and starts with an empty snapshot', async () => {
    const { directory, path, store } = await setup()
    await writeFile(path, '{broken', 'utf8')
    expect((await store.list()).projects).toEqual([
      expect.objectContaining({ name: 'Trash', systemKind: 'trash', readOnly: true })
    ])
    expect((await readdir(directory)).some((name) => name.startsWith('projects-v1.json.corrupt-'))).toBe(true)
    await store.create('Recovered')
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1)
  })

  it('upgrades an existing trash project without losing assignments', async () => {
    const { path, store } = await setup()
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      projects: [{ id: 'threadbox:legacy-trash', name: 'trash', createdAt: 1, updatedAt: 2 }],
      assignments: { root: 'threadbox:legacy-trash' }
    }), 'utf8')
    await store.setInventory([record({ id: 'root' })])

    const snapshot = await store.list()
    const trash = snapshot.projects.find((project) => project.systemKind === 'trash')!
    expect(trash).toMatchObject({
      id: 'threadbox:legacy-trash', name: 'Trash', readOnly: true, canCreateThread: false
    })
    expect(snapshot.assignments).toEqual({ root: trash.id })
    await expect(store.renameProject(trash.id, 'Bin')).rejects.toThrow(/cannot be renamed/)
    await expect(store.deleteProject(trash.id)).rejects.toThrow(/cannot be deleted/)
  })

  it('restores trashed tasks to their previous project', async () => {
    const { path, store } = await setup()
    await store.setInventory([record({ id: 'root' })])
    const focus = (await store.create('Focus')).projects.find((project) => project.name === 'Focus')!
    await store.assign(['root'], focus.id)

    const trashed = await store.moveToTrash(['root'])
    const trash = trashed.projects.find((project) => project.systemKind === 'trash')!
    expect(trashed.assignments).toEqual({ root: trash.id })
    expect(JSON.parse(await readFile(path, 'utf8')).trashOrigins).toEqual({ root: focus.id })

    const restored = await store.restoreFromTrash(['root'])
    expect(restored.assignments).toEqual({ root: focus.id })
    expect(JSON.parse(await readFile(path, 'utf8')).trashOrigins).toEqual({})
  })
})
