// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { BatchOperationResult, ThreadRecord } from '../../src/shared/contracts'
import { recoverWriterAndTrash, type WriterOwner } from '../../packages/vscode/src/writer-recovery'

const id = '019f0000-0000-7000-8000-000000000001'
const otherId = '019f0000-0000-7000-8000-000000000002'
const owner: WriterOwner = {
  pid: 12345, startTime: '100', uid: 1000, executable: '/trusted/codex',
  executableDevice: '1', executableInode: '9',
  locks: [{ id, path: '/codex/thread-writer-locks/' + id + '.lock', device: '1', inode: '2' }]
}
const thread = { id, title: 'Test', parentThreadId: null } as ThreadRecord
const success: BatchOperationResult = { succeeded: [id], failed: [], skipped: [], cascadedCount: 0, refreshedAt: 1 }
const locked: BatchOperationResult = {
  ...success, succeeded: [], failed: [{ id, message: 'thread ' + id + ' already has an active writer' }]
}
function setup() {
  const backend = {
    inspect: vi.fn().mockResolvedValueOnce(owner).mockResolvedValue(null),
    signal: vi.fn<(id: string, owner: WriterOwner, force: boolean) => Promise<void>>().mockResolvedValue(undefined),
    released: vi.fn(async () => true)
  }
  const options = {
    backend, trash: vi.fn().mockResolvedValueOnce(locked).mockResolvedValue(success),
    inventory: vi.fn(async () => [thread]),
    preview: vi.fn(async () => ({ requestedIds: [id], roots: [{ id, title: 'Test', cwd: '/work', descendantCount: 0 }], skipped: [], cascadedCount: 0, refreshedAt: 1 })),
    guard: vi.fn(),
    confirm: vi.fn<(owner: WriterOwner, threads: readonly ThreadRecord[], force: boolean) => Promise<boolean>>().mockResolvedValue(true),
    waitMs: 0, pollMs: 0
  }
  return options
}

describe('Linux writer recovery coordinator', () => {
  it('retries normally, confirms termination, verifies release, then uses Trash again', async () => {
    const options = setup()
    await expect(recoverWriterAndTrash([id], options)).resolves.toEqual(success)
    expect(options.confirm).toHaveBeenCalledWith(owner, [thread], false)
    expect(options.backend.signal).toHaveBeenCalledExactlyOnceWith(id, owner, false)
    expect(options.trash).toHaveBeenCalledTimes(2)
    expect(options.preview).toHaveBeenCalledTimes(2)
  })
  it('does not touch processes if ordinary retry already succeeds', async () => {
    const options = setup()
    options.trash.mockReset().mockResolvedValue(success)
    await recoverWriterAndTrash([id], options)
    expect(options.backend.inspect).not.toHaveBeenCalled()
    expect(options.confirm).not.toHaveBeenCalled()
  })
  it('does not signal when the initial confirmation is cancelled', async () => {
    const options = setup()
    options.confirm.mockResolvedValue(false)
    await expect(recoverWriterAndTrash([id], options)).resolves.toBeNull()
    expect(options.backend.signal).not.toHaveBeenCalled()
    expect(options.trash).toHaveBeenCalledOnce()
  })
  it('requires a separate force confirmation after graceful shutdown times out', async () => {
    const options = setup()
    options.backend.released.mockResolvedValueOnce(false).mockResolvedValue(true)
    await recoverWriterAndTrash([id], options)
    expect(options.confirm.mock.calls.map((call) => call[2])).toEqual([false, true])
    expect(options.backend.signal.mock.calls.map((call) => call[2])).toEqual([false, true])
  })
  it('does not force or retry Trash when the second confirmation is cancelled', async () => {
    const options = setup()
    options.backend.released.mockResolvedValue(false)
    options.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(recoverWriterAndTrash([id], options)).resolves.toBeNull()
    expect(options.backend.signal).toHaveBeenCalledExactlyOnceWith(id, owner, false)
    expect(options.trash).toHaveBeenCalledOnce()
  })
  it('fails closed if the PID or lock scope changes before the signal', async () => {
    const options = setup()
    options.backend.signal.mockRejectedValue(new Error('process identity changed'))
    await expect(recoverWriterAndTrash([id], options)).rejects.toThrow('identity changed')
    expect(options.trash).toHaveBeenCalledOnce()
  })
  it('does not chase a replacement writer after releasing the approved process', async () => {
    const options = setup()
    options.backend.inspect.mockReset().mockResolvedValueOnce(owner).mockResolvedValue({ ...owner, pid: 67890 })
    await expect(recoverWriterAndTrash([id], options)).rejects.toThrow('Another Codex process')
    expect(options.backend.signal).toHaveBeenCalledOnce()
    expect(options.trash).toHaveBeenCalledOnce()
  })
  it('rechecks trust and task protection after confirmation', async () => {
    const options = setup()
    options.confirm.mockImplementation(async () => {
      options.guard.mockImplementation(() => { throw new Error('Workspace not trusted') })
      return true
    })
    await expect(recoverWriterAndTrash([id], options)).rejects.toThrow('not trusted')
    expect(options.backend.signal).not.toHaveBeenCalled()
  })
  it('rejects a lock belonging to an unrelated task', async () => {
    const options = setup()
    options.trash.mockReset().mockResolvedValue({ ...locked, failed: [{ id, message: 'thread ' + otherId + ' already has an active writer' }] })
    await expect(recoverWriterAndTrash([id], options)).rejects.toThrow('selected task family')
    expect(options.backend.inspect).not.toHaveBeenCalled()
  })
  it('does not signal if the task becomes protected after confirmation', async () => {
    const options = setup()
    options.confirm.mockImplementation(async () => {
      options.preview.mockResolvedValue({ requestedIds: [id], roots: [], skipped: [{ id, message: 'Pinned' }] as never[], cascadedCount: 0, refreshedAt: 1 })
      return true
    })
    await expect(recoverWriterAndTrash([id], options)).rejects.toThrow('now running, pinned')
    expect(options.backend.signal).not.toHaveBeenCalled()
  })
})
