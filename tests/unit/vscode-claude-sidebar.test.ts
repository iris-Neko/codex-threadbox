// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeSession } from '../../packages/vscode/src/claude-history'

const ui = vi.hoisted(() => ({ input: vi.fn(), clipboard: vi.fn() }))
vi.mock('vscode', () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose() {} },
  TreeItem: class { constructor(public label: string) {} },
  ThemeIcon: class { constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  window: { showInputBox: ui.input }, env: { clipboard: { writeText: ui.clipboard } }
}))

import { ClaudeHistorySidebar } from '../../packages/vscode/src/claude-sidebar'
import { openClaudeSession, type ClaudeOpenHost } from '../../packages/vscode/src/claude-integration'
import { ClaudeResumeStore } from '../../packages/vscode/src/claude-resume'

let cwd: string
const id = '11111111-1111-4111-8111-111111111111'
const record: ClaudeSession = { id, title: 'Other folder chat', cwd: '/other/folder', updatedAt: 123, createdAt: null }
beforeAll(async () => { cwd = await mkdtemp(join(tmpdir(), 'threadbox-claude-open-')) })
afterAll(async () => { await rm(cwd, { recursive: true, force: true }) })
beforeEach(() => { vi.clearAllMocks() })

describe('independent Claude native history view', () => {
  function setup() {
    const reader = { list: vi.fn(async () => [record]), get: vi.fn(async () => record) }
    const host = { guard: vi.fn(), configDir: () => '/home/claude', locale: () => 'en', open: vi.fn(async () => {}) }
    return { reader, host, sidebar: new ClaudeHistorySidebar(reader, host) }
  }
  it('lists unrelated folders without any Codex dependency and opens only known entries', async () => {
    const { reader, host, sidebar } = setup()
    const rows = await sidebar.getChildren()
    expect(rows[0]?.label).toBe('/other/folder')
    expect(rows[0]?.children?.[0]?.contextValue).toBe('threadbox.claude.session')
    await sidebar.open(id)
    expect(host.open).toHaveBeenCalledWith(record, '/home/claude')
    await expect(sidebar.open({ id, cwd: '/forged' })).rejects.toThrow()
    await expect(sidebar.open('not-listed')).rejects.toThrow('no longer')
    expect(reader.list).toHaveBeenCalledTimes(1)
    sidebar.dispose()
  })
  it('filters search in memory, clears it, and refreshes metadata', async () => {
    const { reader, sidebar } = setup()
    await sidebar.getChildren()
    ui.input.mockResolvedValue('not-found')
    await sidebar.search()
    expect((await sidebar.getChildren()).some((row) => row.label === 'No matching conversations')).toBe(true)
    sidebar.clearSearch()
    expect((await sidebar.getChildren())[0]?.children).toHaveLength(1)
    expect(reader.list).toHaveBeenCalledTimes(1)
    sidebar.refresh()
    reader.list.mockResolvedValue([])
    expect((await sidebar.getChildren())[0]?.label).toBe('No Claude Code history on this host')
    sidebar.dispose()
  })
  it('never reads history or opens a conversation in an untrusted workspace', async () => {
    const { reader, host, sidebar } = setup()
    host.guard.mockImplementation(() => { throw new Error('untrusted') })
    expect((await sidebar.getChildren())[0]?.label).toContain('Trust')
    await expect(sidebar.open(id)).rejects.toThrow('untrusted')
    expect(reader.list).not.toHaveBeenCalled()
    expect(host.open).not.toHaveBeenCalled()
    sidebar.dispose()
  })
  it('does not publish stale data after configuration changes', async () => {
    const { reader, sidebar } = setup()
    let complete!: (records: ClaudeSession[]) => void
    reader.list.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const pending = sidebar.getChildren()
    sidebar.refresh()
    complete([record])
    expect(await pending).toEqual([])
    reader.list.mockResolvedValue([])
    expect((await sidebar.getChildren())[0]?.label).toContain('No Claude Code')
    sidebar.dispose()
  })
})

describe('safe Claude conversation opening', () => {
  function setup() {
    const session = { ...record, cwd }
    const reader = { list: vi.fn(async () => [session]), get: vi.fn(async () => session) }
    const store = { enqueue: vi.fn(async () => vi.fn(async () => {})) }
    const host = {
      guard: vi.fn(), configDir: () => '/home/claude', folders: vi.fn(() => [cwd]),
      ensureExtension: vi.fn(async () => {}), confirm: vi.fn(async () => true),
      openWindow: vi.fn(async () => {}), resume: vi.fn(async () => {})
    } satisfies ClaudeOpenHost
    const open = () => openClaudeSession(session, '/home/claude', reader, store as unknown as ClaudeResumeStore, host)
    return { reader, store, host, session, open }
  }
  it('verifies metadata and resumes the exact ID in the matching workspace, without a prompt', async () => {
    const { open, reader, host, store } = setup()
    await open()
    expect(reader.get).toHaveBeenCalledWith('/home/claude', id, cwd)
    expect(host.resume).toHaveBeenCalledExactlyOnceWith(id, cwd, '/home/claude')
    expect(host.confirm).not.toHaveBeenCalled()
    expect(store.enqueue).not.toHaveBeenCalled()
  })
  it('opens a separate original-folder window and never resumes into the wrong workspace', async () => {
    const { open, host, store, session } = setup()
    host.folders.mockReturnValue(['/different'])
    await open()
    expect(host.confirm).toHaveBeenCalledWith(cwd)
    expect(store.enqueue).toHaveBeenCalledWith(session, '/home/claude')
    expect(host.openWindow).toHaveBeenCalledWith(cwd)
    expect(host.resume).not.toHaveBeenCalled()
  })
  it('also requires a dedicated folder in a multi-root workspace', async () => {
    const { open, host } = setup()
    host.folders.mockReturnValue([cwd, '/another'])
    await open()
    expect(host.openWindow).toHaveBeenCalledWith(cwd)
    expect(host.resume).not.toHaveBeenCalled()
  })
  it('does nothing on cancellation', async () => {
    const { open, host, store } = setup()
    host.folders.mockReturnValue([])
    host.confirm.mockResolvedValue(false)
    await open()
    expect(store.enqueue).not.toHaveBeenCalled()
    expect(host.openWindow).not.toHaveBeenCalled()
    expect(host.resume).not.toHaveBeenCalled()
  })
  it('rolls back the handoff if opening the folder fails', async () => {
    const { open, host, store } = setup()
    const cancel = vi.fn(async () => {})
    store.enqueue.mockResolvedValue(cancel)
    host.folders.mockReturnValue([])
    host.openWindow.mockRejectedValue(new Error('window failed'))
    await expect(open()).rejects.toThrow('window failed')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rechecks trust after confirmation and never writes a pending request', async () => {
    const { open, host, store } = setup()
    host.folders.mockReturnValue([])
    host.confirm.mockImplementation(async () => {
      host.guard.mockImplementation(() => { throw new Error('untrusted') })
      return true
    })
    await expect(open()).rejects.toThrow('untrusted')
    expect(store.enqueue).not.toHaveBeenCalled()
    expect(host.openWindow).not.toHaveBeenCalled()
  })
  it('refuses mismatched Claude homes or moved histories rather than opening a new chat', async () => {
    const { open, host, reader } = setup()
    host.configDir = () => '/different-home'
    await expect(open()).rejects.toThrow('different config')
    expect(reader.get).not.toHaveBeenCalled()
    host.configDir = () => '/home/claude'
    reader.get.mockResolvedValue({ ...record, cwd: '/moved' })
    await expect(open()).rejects.toThrow('removed or moved')
    expect(host.resume).not.toHaveBeenCalled()
    expect(host.openWindow).not.toHaveBeenCalled()
  })
})
