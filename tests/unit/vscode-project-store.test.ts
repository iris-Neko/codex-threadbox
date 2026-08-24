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
    const project = created.projects[0]!
    expect(project).toMatchObject({ name: 'Release', kind: 'threadbox', readOnly: false })
    await expect(store.create(' release ')).rejects.toThrow(/already exists/)

    const renamed = await store.renameProject(project.id, 'Launch')
    expect(renamed.projects[0]?.name).toBe('Launch')
    const reloaded = new ProjectStore(path)
    expect((await reloaded.list()).projects[0]?.name).toBe('Launch')
  })

  it('serializes concurrent project writes', async () => {
    const { path, store } = await setup()
    await Promise.all([store.create('Alpha'), store.create('Beta')])
    const names = (await new ProjectStore(path).list()).projects.map((project) => project.name).toSorted()
    expect(names).toEqual(['Alpha', 'Beta'])
  })

  it('assigns parent and child selections to the root task', async () => {
    const { store } = await setup()
    const root = record({ id: 'root', descendantCount: 1 })
    const child = record({ id: 'child', parentThreadId: 'root', internal: true })
    await store.setInventory([root, child])
    const project = (await store.create('Focus')).projects[0]!

    const assigned = await store.assign(['child'], project.id)
    expect(assigned.assignments).toEqual({ root: project.id })
    expect((await store.assign(['root', 'child'], null)).assignments).toEqual({})
  })

  it('removes project assignments without changing the inventory', async () => {
    const { store } = await setup()
    const task = record({ id: 'task' })
    await store.setInventory([task])
    const project = (await store.create('Temporary')).projects[0]!
    await store.assign(['task'], project.id)

    const deleted = await store.deleteProject(project.id)
    expect(deleted.projects).toEqual([])
    expect(deleted.assignments).toEqual({})
    await expect(store.assign(['task'], project.id)).rejects.toThrow(/not found/)
  })

  it('prunes missing tasks and preserves official projects as read-only', async () => {
    const { store } = await setup()
    const official = record({ id: 'official-task', projectId: 'codex-project', cwd: '/work/product' })
    await store.setInventory([official])
    const project = (await store.create('Keep')).projects.find((item) => item.kind === 'threadbox')!
    await store.assign(['official-task'], project.id)
    const pruned = await store.setInventory([])
    expect(pruned.assignments).toEqual({})

    const restored = await store.setInventory([official])
    expect(restored.projects.find((item) => item.kind === 'official')).toMatchObject({
      id: 'official:codex-project', name: 'product', readOnly: true
    })
  })

  it('backs up a corrupt file and starts with an empty snapshot', async () => {
    const { directory, path, store } = await setup()
    await writeFile(path, '{broken', 'utf8')
    expect((await store.list()).projects).toEqual([])
    expect((await readdir(directory)).some((name) => name.startsWith('projects-v1.json.corrupt-'))).toBe(true)
    await store.create('Recovered')
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1)
  })
})
