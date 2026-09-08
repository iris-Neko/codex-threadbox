// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { RpcClientLike } from '../../packages/core/src/app-server-client'
import { renameThread } from '../../packages/vscode/src/rename-thread'
import { normalizeThreadName } from '../../src/shared/thread-name'

const id = '019f0000-0000-7000-8000-000000000001'
function setup() {
  const request = vi.fn().mockResolvedValueOnce({ thread: { id, name: 'Old', ephemeral: false } })
    .mockResolvedValueOnce({}).mockResolvedValueOnce({ thread: { id, name: '新名字' } })
  return { request, client: { request } as unknown as RpcClientLike }
}
describe('VS Code task renaming', () => {
  it('renames and verifies metadata without loading a thread or changing other state', async () => {
    const { request, client } = setup()
    await renameThread(client, id, ' 新名字 ', () => undefined)
    expect(request.mock.calls).toEqual([
      ['thread/read', { threadId: id, includeTurns: false }],
      ['thread/name/set', { threadId: id, name: '新名字' }],
      ['thread/read', { threadId: id, includeTurns: false }]
    ])
  })
  it.each(['', '   ', 'bad\nname', 'bad\tname', 'bad\u007fname', 'x'.repeat(513)])('rejects invalid names before RPC', async (name) => {
    const { client, request } = setup()
    await expect(renameThread(client, id, name, () => undefined)).rejects.toThrow(/visible characters/)
    expect(request).not.toHaveBeenCalled()
  })
  it('accepts Unicode and the maximum length', () => {
    expect(normalizeThreadName(' 实验 🧪 ')).toBe('实验 🧪')
    expect(normalizeThreadName('x'.repeat(512))).toHaveLength(512)
  })
  it('rejects invalid IDs and untrusted workspaces before RPC', async () => {
    const { client, request } = setup()
    await expect(renameThread(client, '../other', 'Name', () => undefined)).rejects.toThrow('Invalid task ID')
    await expect(renameThread(client, id, 'Name', () => { throw new Error('Untrusted') })).rejects.toThrow('Untrusted')
    expect(request).not.toHaveBeenCalled()
  })
  it('does not mutate if trust is revoked after metadata lookup', async () => {
    const { client, request } = setup()
    const guard = vi.fn().mockImplementationOnce(() => undefined).mockImplementation(() => { throw new Error('Untrusted') })
    await expect(renameThread(client, id, 'Name', guard)).rejects.toThrow('Untrusted')
    expect(request).toHaveBeenCalledOnce()
  })
  it('rejects an unverified target and skips unchanged names', async () => {
    const { client, request } = setup()
    request.mockReset().mockResolvedValue({ thread: { id: 'different', name: 'Old' } })
    await expect(renameThread(client, id, 'Name', () => undefined)).rejects.toThrow(/verified/)
    request.mockReset().mockResolvedValue({ thread: { id, name: 'Same' } })
    await renameThread(client, id, 'Same', () => undefined)
    expect(request).toHaveBeenCalledOnce()
  })
  it('reports a failed rename without deleting or recreating the task', async () => {
    const { client, request } = setup()
    request.mockReset().mockResolvedValueOnce({ thread: { id, name: 'Old' } }).mockRejectedValueOnce(new Error('rename failed'))
    await expect(renameThread(client, id, 'Name', () => undefined)).rejects.toThrow('rename failed')
    expect(request.mock.calls.map((call) => call[0])).toEqual(['thread/read', 'thread/name/set'])
  })
  it('does not report success if the persisted name differs', async () => {
    const { client } = setup()
    await expect(renameThread(client, id, 'Other name', () => undefined)).rejects.toThrow(/could not be confirmed/)
  })
  it('explains archived-name failures without secretly restoring the task', async () => {
    const { client, request } = setup()
    request.mockReset().mockResolvedValueOnce({ thread: { id, name: 'Old' } })
      .mockRejectedValueOnce(new Error('no rollout found for thread id ' + id))
    await expect(renameThread(client, id, 'Name', () => undefined)).rejects.toThrow('Restore archived')
    expect(request.mock.calls.map((call) => call[0])).toEqual(['thread/read', 'thread/name/set'])
  })
})
