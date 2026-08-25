// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '../../packages/vscode/src/project-store'
import { TrashController } from '../../packages/vscode/src/trash-controller'
import type {
  BatchOperationResult,
  DeletePreview,
  DeleteThreadsOptions,
  ListThreadsResult,
  ThreadRecord
} from '../../src/shared/contracts'

const temporaryDirectories: string[] = []

function record(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id, title: id, preview: '', cwd: `/work/${id}`, projectId: null,
    createdAt: 1, updatedAt: 2, source: 'vscode', archived: false, pinned: false,
    status: 'idle', parentThreadId: null, descendantCount: 0, internal: false,
    ineligibleReason: null, ...overrides
  }
}

function result(succeeded: string[], skipped: BatchOperationResult['skipped'] = []): BatchOperationResult {
  return { succeeded, failed: [], skipped, cascadedCount: 0, refreshedAt: Date.now() }
}

class FakeThreadService {
  readonly calls = {
    archive: [] as string[][],
    unarchive: [] as string[][],
    delete: [] as string[][],
    deleteOptions: [] as DeleteThreadsOptions[]
  }

  constructor(readonly threads: ThreadRecord[]) {}

  async listThreads(): Promise<ListThreadsResult> {
    return {
      threads: this.threads.map((thread) => ({ ...thread })),
      environment: {
        state: 'ready', cliPath: '/codex', cliVersion: '0.149.0', minimumVersion: '0.149.0',
        message: null, externalCodexProcesses: 0, capabilities: { pinning: true }
      },
      desktopRecents: { state: 'unavailable', staleCount: 0, staleEntries: [], message: null },
      refreshedAt: Date.now()
    }
  }

  async previewDeleteThreads(ids: string[]): Promise<DeletePreview> {
    const roots: DeletePreview['roots'] = []
    const skipped: DeletePreview['skipped'] = []
    for (const id of ids) {
      const thread = this.threads.find((item) => item.id === id)
      if (!thread) skipped.push({ id, message: 'Thread was not found.' })
      else if (thread.status === 'active' || thread.pinned) {
        skipped.push({ id, message: 'Thread is protected.' })
      } else {
        roots.push({ id, title: thread.title, cwd: thread.cwd, descendantCount: 0 })
      }
    }
    return { requestedIds: ids, roots, skipped, cascadedCount: 0, refreshedAt: Date.now() }
  }

  async archiveThreads(ids: string[]): Promise<BatchOperationResult> {
    this.calls.archive.push(ids)
    for (const id of ids) this.threads.find((thread) => thread.id === id)!.archived = true
    return result(ids)
  }

  async unarchiveThreads(ids: string[]): Promise<BatchOperationResult> {
    this.calls.unarchive.push(ids)
    for (const id of ids) this.threads.find((thread) => thread.id === id)!.archived = false
    return result(ids)
  }

  async deleteThreads(ids: string[], options: DeleteThreadsOptions): Promise<BatchOperationResult> {
    this.calls.delete.push(ids)
    this.calls.deleteOptions.push(options)
    for (const id of ids) {
      const index = this.threads.findIndex((thread) => thread.id === id)
      if (index >= 0) this.threads.splice(index, 1)
    }
    return result(ids)
  }
}

async function setup(threads: ThreadRecord[]): Promise<{
  service: FakeThreadService
  store: ProjectStore
  controller: TrashController
}> {
  const directory = await mkdtemp(join(tmpdir(), 'threadbox-trash-controller-'))
  temporaryDirectories.push(directory)
  const store = new ProjectStore(join(directory, 'projects-v1.json'))
  await store.setInventory(threads)
  const service = new FakeThreadService(threads)
  return { service, store, controller: new TrashController(service, store) }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  ))
})

describe('VS Code Trash controller', () => {
  it('archives tasks into Trash and restores their previous project', async () => {
    const task = record('root')
    const { controller, service, store } = await setup([task])
    const focus = (await store.create('Focus')).projects.find((project) => project.name === 'Focus')!
    await store.assign(['root'], focus.id)

    expect((await controller.trash(['root'])).succeeded).toEqual(['root'])
    expect(service.calls.archive).toEqual([['root']])
    const trashed = await store.list()
    const trash = trashed.projects.find((project) => project.systemKind === 'trash')!
    expect(trashed.assignments).toEqual({ root: trash.id })

    expect((await controller.restore(['root'])).succeeded).toEqual(['root'])
    expect(service.calls.unarchive).toEqual([['root']])
    expect((await store.list()).assignments).toEqual({ root: focus.id })
  })

  it('restores official Codex tasks without changing their official project', async () => {
    const task = record('official', { projectId: 'codex-project' })
    const { controller, store } = await setup([task])

    await controller.trash([task.id])
    expect((await store.list()).assignments[task.id]).toBeTruthy()
    await controller.restore([task.id])

    expect((await store.list()).assignments[task.id]).toBeUndefined()
    expect(task.projectId).toBe('codex-project')
  })

  it('keeps protected tasks out of Trash', async () => {
    const pinned = record('pinned', { pinned: true, ineligibleReason: 'pinned' })
    const { controller, service, store } = await setup([pinned])

    const moved = await controller.trash(['pinned'])
    expect(moved.succeeded).toEqual([])
    expect(moved.skipped).toEqual([{ id: 'pinned', message: 'Thread is protected.' }])
    expect(service.calls.archive).toEqual([])
    expect((await store.list()).assignments).toEqual({})
  })

  it('unarchives a task when writing its Trash assignment fails', async () => {
    const task = record('rollback-trash')
    const { controller, service, store } = await setup([task])
    vi.spyOn(store, 'moveToTrash').mockRejectedValueOnce(new Error('disk full'))

    await expect(controller.trash([task.id])).rejects.toThrow(task.id)
    expect(service.calls.archive).toEqual([[task.id]])
    expect(service.calls.unarchive).toEqual([[task.id]])
    expect(task.archived).toBe(false)
  })

  it('re-archives a task when writing its restored assignment fails', async () => {
    const task = record('rollback-restore')
    const { controller, service, store } = await setup([task])
    await controller.trash([task.id])
    vi.spyOn(store, 'restoreFromTrash').mockRejectedValueOnce(new Error('disk full'))

    await expect(controller.restore([task.id])).rejects.toThrow(task.id)
    expect(service.calls.unarchive).toEqual([[task.id]])
    expect(service.calls.archive).toEqual([[task.id], [task.id]])
    expect(task.archived).toBe(true)
  })

  it('permanently deletes only tasks currently assigned to Trash', async () => {
    const trashed = record('trashed')
    const kept = record('kept')
    const { controller, service, store } = await setup([trashed, kept])
    await controller.trash(['trashed'])

    expect((await controller.empty()).succeeded).toEqual(['trashed'])
    expect(service.calls.delete).toEqual([['trashed']])
    expect(service.calls.deleteOptions).toEqual([{ trashWorkingDirectories: [] }])
    expect(service.threads.map((thread) => thread.id)).toEqual(['kept'])
    expect(await store.listTrashRoots()).toEqual([])
  })
})
