import type {
  BatchOperationResult,
  DeletePreview,
  DeleteThreadsOptions,
  ListThreadsResult,
  OperationFailure,
  ProjectSnapshot
} from '../../../src/shared/contracts'
import type { ProjectStore } from './project-store'

interface TrashThreadService {
  listThreads(): Promise<ListThreadsResult>
  previewDeleteThreads(ids: string[]): Promise<DeletePreview>
  archiveThreads(ids: string[]): Promise<BatchOperationResult>
  unarchiveThreads(ids: string[]): Promise<BatchOperationResult>
  deleteThreads(ids: string[], options: DeleteThreadsOptions): Promise<BatchOperationResult>
}

function emptyResult(): BatchOperationResult {
  return {
    succeeded: [],
    failed: [],
    skipped: [],
    cascadedCount: 0,
    refreshedAt: Date.now()
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function skipped(id: string, message: string): OperationFailure {
  return { id, message }
}

function failedRollbackIds(ids: readonly string[], result: BatchOperationResult): string[] {
  const restored = new Set(result.succeeded)
  return unique([
    ...ids.filter((id) => !restored.has(id)),
    ...result.failed.map((item) => item.id),
    ...result.skipped.map((item) => item.id)
  ])
}

export class TrashController {
  constructor(
    private readonly service: TrashThreadService,
    private readonly projects: ProjectStore
  ) {}

  async trash(ids: string[]): Promise<BatchOperationResult> {
    const preview = await this.service.previewDeleteThreads(ids)
    const listed = await this.service.listThreads()
    await this.projects.setInventory(listed.threads)
    const byId = new Map(listed.threads.map((thread) => [thread.id, thread]))
    const roots = preview.roots.map((root) => root.id)
    const alreadyTrashed = new Set(await this.projects.filterTrashRoots(roots))
    const candidates = roots.filter((id) => !alreadyTrashed.has(id))
    const alreadyArchived = candidates.filter((id) => byId.get(id)?.archived)
    const toArchive = candidates.filter((id) => !byId.get(id)?.archived)
    const archived = toArchive.length > 0
      ? await this.service.archiveThreads(toArchive)
      : emptyResult()
    const moved = unique([...alreadyArchived, ...archived.succeeded])

    if (moved.length > 0) {
      try {
        await this.projects.moveToTrash(moved)
      } catch (error) {
        let rollbackFailed = archived.succeeded
        try {
          const rollback = await this.service.unarchiveThreads(archived.succeeded)
          rollbackFailed = failedRollbackIds(archived.succeeded, rollback)
        } catch {
          // Every newly archived task remains relevant to the recovery message.
        }
        const suffix = rollbackFailed.length > 0
          ? ` Archive rollback also failed for task IDs: ${rollbackFailed.join(', ')}.`
          : ''
        throw new Error(
          `Tasks were archived but could not be added to Trash: ${moved.join(', ')}.${suffix}`,
          { cause: error }
        )
      }
    }

    return {
      succeeded: moved,
      failed: archived.failed,
      skipped: [
        ...preview.skipped,
        ...[...alreadyTrashed].map((id) => skipped(id, 'Task is already in Trash.')),
        ...archived.skipped
      ],
      cascadedCount: preview.cascadedCount,
      refreshedAt: Date.now()
    }
  }

  async restore(ids: string[], projectId?: string | null): Promise<BatchOperationResult> {
    const listed = await this.service.listThreads()
    await this.projects.setInventory(listed.threads)
    const byId = new Map(listed.threads.map((thread) => [thread.id, thread]))
    const known = ids.filter((id) => byId.has(id))
    const unknown = ids.filter((id) => !byId.has(id))
    const roots = known.length > 0 ? this.projects.resolveRootIds(known) : []
    const trashed = new Set(await this.projects.filterTrashRoots(roots))
    const alreadyActive = [...trashed].filter((id) => !byId.get(id)?.archived)
    const toUnarchive = [...trashed].filter((id) => byId.get(id)?.archived)
    const unarchived = toUnarchive.length > 0
      ? await this.service.unarchiveThreads(toUnarchive)
      : emptyResult()
    const restored = unique([...alreadyActive, ...unarchived.succeeded])

    if (restored.length > 0) {
      try {
        await this.projects.restoreFromTrash(restored, projectId)
      } catch (error) {
        let rollbackFailed = unarchived.succeeded
        try {
          const rollback = await this.service.archiveThreads(unarchived.succeeded)
          rollbackFailed = failedRollbackIds(unarchived.succeeded, rollback)
        } catch {
          // Every newly unarchived task remains relevant to the recovery message.
        }
        const suffix = rollbackFailed.length > 0
          ? ` Restore rollback also failed for task IDs: ${rollbackFailed.join(', ')}.`
          : ''
        throw new Error(
          `Tasks were unarchived but their Trash assignments could not be restored: ${restored.join(', ')}.${suffix}`,
          { cause: error }
        )
      }
    }

    return {
      succeeded: restored,
      failed: unarchived.failed,
      skipped: [
        ...unknown.map((id) => skipped(id, 'Task was not found.')),
        ...roots.filter((id) => !trashed.has(id)).map((id) => skipped(id, 'Task is not in Trash.')),
        ...unarchived.skipped
      ],
      cascadedCount: 0,
      refreshedAt: Date.now()
    }
  }

  async assign(ids: string[], projectId: string | null): Promise<ProjectSnapshot> {
    const listed = await this.service.listThreads()
    await this.projects.setInventory(listed.threads)
    const trashId = await this.projects.getTrashProjectId()
    if (projectId === trashId) {
      await this.trash(ids)
      return this.projects.list()
    }

    const roots = this.projects.resolveRootIds(ids)
    const trashed = await this.projects.filterTrashRoots(roots)
    if (trashed.length > 0) await this.restore(trashed, projectId)
    const trashedSet = new Set(trashed)
    const ordinary = roots.filter((id) => !trashedSet.has(id))
    if (ordinary.length > 0) await this.projects.assign(ordinary, projectId)
    return this.projects.list()
  }

  async empty(): Promise<BatchOperationResult> {
    const listed = await this.service.listThreads()
    await this.projects.setInventory(listed.threads)
    const roots = await this.projects.listTrashRoots()
    if (roots.length === 0) return emptyResult()
    const result = await this.service.deleteThreads(roots, { trashWorkingDirectories: [] })
    if (result.succeeded.length > 0) {
      try {
        await this.projects.removeFromTrash(result.succeeded)
      } catch (error) {
        throw new Error(
          `Tasks were permanently deleted but Trash metadata cleanup failed. Task IDs: ${result.succeeded.join(', ')}.`,
          { cause: error }
        )
      }
    }
    return result
  }
}
