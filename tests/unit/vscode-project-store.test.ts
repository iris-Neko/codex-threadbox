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

  it('imports matching workspace roots atomically and moves existing assignments', async () => {
    const { store } = await setup()
    const root = record({ id: 'root', cwd: '/work/app', status: 'active', pinned: true })
    const child = record({ id: 'child', cwd: '/elsewhere', parentThreadId: 'root', internal: true })
    const docs = record({ id: 'docs', cwd: '/work/docs/guide', archived: true })
    const prefix = record({ id: 'prefix', cwd: '/work/application' })
    await store.setInventory([root, child, docs, prefix])
    const old = (await store.create('Old')).projects.find((item) => item.name === 'Old')!
    await store.assign(['root'], old.id)

    const imported = await store.importWorkspace('Workspace', ['/work/app', '/work/docs'])
    expect(imported.alreadyImported).toBe(false)
    expect(imported.importedRootCount).toBe(2)
    expect(imported.snapshot.assignments).toEqual({
      root: imported.projectId,
      docs: imported.projectId
    })
    expect(imported.snapshot.assignments).not.toHaveProperty('child')
    expect(imported.snapshot.assignments).not.toHaveProperty('prefix')
    expect(imported.snapshot.projects.find((item) => item.id === imported.projectId)?.roots)
      .toEqual(['/work/app', '/work/docs/guide'])
  })

  it('matches Windows and UNC paths without case sensitivity', async () => {
    const { store } = await setup()
    await store.setInventory([
      record({ id: 'windows', cwd: 'C:\\Work\\App\\src' }),
      record({ id: 'unc', cwd: '\\\\Server\\Share\\Repo\\src' }),
      record({ id: 'other', cwd: 'C:\\Work\\Application' })
    ])

    const imported = await store.importWorkspace('Windows', [
      'c:\\work\\app',
      '\\\\server\\share\\repo'
    ])
    expect(imported.snapshot.assignments).toEqual({
      windows: imported.projectId,
      unc: imported.projectId
    })
  })

  it('imports tasks below the POSIX filesystem root', async () => {
    const { store } = await setup()
    await store.setInventory([
      record({ id: 'root-directory', cwd: '/work/app' }),
      record({ id: 'relative', cwd: 'work/app' })
    ])

    const imported = await store.importWorkspace('Root', ['/'])
    expect(imported.snapshot.assignments).toEqual({
      'root-directory': imported.projectId
    })
  })

  it('keeps Trash tasks out and detects an already imported workspace', async () => {
    const { store } = await setup()
    const kept = record({ id: 'kept', cwd: '/work/app' })
    const trashed = record({ id: 'trashed', cwd: '/work/app/old' })
    await store.setInventory([kept, trashed])
    await store.moveToTrash(['trashed'])

    const imported = await store.importWorkspace('Workspace', ['/work/app'])
    const preview = await store.previewWorkspaceImport(['/work/app'])
    const repeated = await store.importWorkspace('Ignored name', ['/work/app'])
    const trash = imported.snapshot.projects.find((item) => item.systemKind === 'trash')!
    expect(preview.existingProject?.id).toBe(imported.projectId)
    expect(repeated).toMatchObject({ alreadyImported: true, projectId: imported.projectId })
    expect(repeated.snapshot.assignments).toEqual({
      kept: imported.projectId,
      trashed: trash.id
    })
    expect(repeated.snapshot.projects.filter((item) => item.systemKind !== 'trash')).toHaveLength(1)
  })

  it('does not create a project when no workspace task matches or saving fails', async () => {
    const { directory, store } = await setup()
    await store.setInventory([record({ id: 'outside', cwd: '/outside' })])
    await expect(store.importWorkspace('Missing', ['/work/app'])).rejects.toThrow(/No eligible tasks/)
    expect((await store.list()).projects.filter((item) => item.systemKind !== 'trash')).toEqual([])

    const blocked = join(directory, 'blocked')
    await writeFile(blocked, 'not a directory', 'utf8')
    const failing = new ProjectStore(join(blocked, 'projects-v1.json'))
    await failing.setInventory([record({ id: 'inside', cwd: '/work/app' })])
    await expect(failing.importWorkspace('Atomic', ['/work/app'])).rejects.toThrow()
    expect((await failing.list()).projects.filter((item) => item.systemKind !== 'trash')).toEqual([])
  })

  it('does not write project data while staging a workspace import preview', async () => {
    const { path, store } = await setup()
    await store.setInventory([record({ id: 'old', cwd: '/old' })])
    const project = (await store.create('Existing')).projects.find((item) => item.name === 'Existing')!
    await store.assign(['old'], project.id)
    const before = await readFile(path, 'utf8')

    await store.setInventory([record({ id: 'new', cwd: '/work/app' })], {
      persistPruning: false
    })
    expect((await store.previewWorkspaceImport(['/work/app'])).rootIds).toEqual(['new'])
    expect(await readFile(path, 'utf8')).toBe(before)
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

  it('prunes missing tasks and does not expose task project IDs as VS Code projects', async () => {
    const { store } = await setup()
    const official = record({ id: 'official-task', projectId: 'codex-project', cwd: '/work/product' })
    await store.setInventory([official])
    const project = (await store.create('Keep')).projects.find((item) => item.name === 'Keep')!
    await store.assign(['official-task'], project.id)
    const pruned = await store.setInventory([])
    expect(pruned.assignments).toEqual({})

    const restored = await store.setInventory([official])
    expect(restored.projects.filter((item) => item.kind === 'official')).toEqual([])
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
