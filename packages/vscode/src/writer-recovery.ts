import type { BatchOperationResult, DeletePreview, ThreadRecord } from '../../../src/shared/contracts'

export interface WriterOwner {
  pid: number
  startTime: string
  uid: number
  executable: string
  executableDevice: string
  executableInode: string
  locks: Array<{ id: string; path: string; device: string; inode: string }>
}

export interface WriterRecoveryBackend {
  inspect(threadId: string): Promise<WriterOwner | null>
  signal(threadId: string, owner: WriterOwner, force: boolean): Promise<void>
  released(threadId: string, owner: WriterOwner): Promise<boolean>
}

export interface WriterRecoveryOptions {
  backend: WriterRecoveryBackend
  trash(ids: string[]): Promise<BatchOperationResult>
  inventory(): Promise<ThreadRecord[]>
  preview(ids: string[]): Promise<DeletePreview>
  guard(): void
  confirm(owner: WriterOwner, threads: readonly ThreadRecord[], force: boolean): Promise<boolean>
  waitMs?: number
  pollMs?: number
}

function isInFamily(id: string, root: string, threads: readonly ThreadRecord[]): boolean {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const seen = new Set<string>()
  for (let current: string | null = id; current && !seen.has(current);) {
    if (current === root) return true
    seen.add(current)
    current = byId.get(current)?.parentThreadId ?? null
  }
  return false
}

export async function recoverWriterAndTrash(
  ids: string[], options: WriterRecoveryOptions
): Promise<BatchOperationResult | null> {
  options.guard()
  if (ids.length !== 1) throw new Error('Recover one locked task at a time.')
  // Retry normally first. Never stop a process merely because a stale notification said it was locked.
  const initial = await options.trash(ids)
  if (initial.failed.length !== 1 || initial.succeeded.length > 0 || initial.skipped.length > 0) return initial
  const failure = initial.failed[0]!
  const match = failure.message.match(/thread ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}) already has an active writer/iu)
  if (!match) return initial
  const lockId = match[1]!.toLowerCase()
  const rootId = failure.id
  const threads = await options.inventory()
  if (!threads.some((thread) => thread.id === rootId) || !isInFamily(lockId, rootId, threads) ||
    !isInFamily(ids[0]!, rootId, threads)) {
    throw new Error('The reported writer lock does not belong to the selected task family.')
  }
  const ensureEligible = async (): Promise<void> => {
    options.guard()
    const preview = await options.preview([rootId])
    options.guard()
    if (preview.skipped.length || !preview.roots.some((root) => root.id === rootId)) {
      throw new Error('The selected task or a descendant is now running, pinned, or unavailable. Recovery was stopped.')
    }
  }
  await ensureEligible()
  const owner = await options.backend.inspect(lockId)
  options.guard()
  if (!owner) return options.trash([rootId])
  if (!await options.confirm(owner, threads, false)) return null
  await ensureEligible()
  await options.backend.signal(lockId, owner, false)

  const waitReleased = async (): Promise<boolean> => {
    const deadline = Date.now() + (options.waitMs ?? 5_000)
    do {
      options.guard()
      if (await options.backend.released(lockId, owner)) return true
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250))
    } while (Date.now() <= deadline)
    return false
  }
  if (!await waitReleased()) {
    options.guard()
    if (!await options.confirm(owner, await options.inventory(), true)) return null
    await ensureEligible()
    await options.backend.signal(lockId, owner, true)
    if (!await waitReleased()) throw new Error('The writer did not release the task. Nothing was moved to Trash.')
  }
  options.guard()
  // A restarted/new writer is not covered by the user's consent. Do not chase and stop it.
  if (await options.backend.inspect(lockId)) {
    throw new Error('Another Codex process acquired the task. Retry after closing it; the new process was not stopped.')
  }
  options.guard()
  return options.trash([rootId])
}
