// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadboxApi, ThreadRecord } from '../../src/shared/contracts'

const ui = vi.hoisted(() => ({
  warning: vi.fn(), info: vi.fn(), error: vi.fn(), trusted: true
}))
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = vi.fn(() => ({ dispose() {} }))
    fire = vi.fn()
    dispose() {}
  },
  TreeItem: class { constructor(public label: string) {} },
  ThemeIcon: class { constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  workspace: { get isTrusted() { return ui.trusted } },
  window: { showWarningMessage: ui.warning, showInformationMessage: ui.info, showErrorMessage: ui.error }
}))

import { SidebarItem, ThreadboxSidebarProvider } from '../../packages/vscode/src/sidebar'
import { ProjectAssignmentError } from '../../packages/vscode/src/operation-feedback'

const thread: ThreadRecord = {
  id: 'ordinary', title: 'Ordinary task', cwd: '/work/app', preview: '', source: 'vscode',
  createdAt: 1, updatedAt: 2, status: 'notLoaded', pinned: false, archived: false,
  parentThreadId: null, projectId: null, descendantCount: 0, internal: false, ineligibleReason: null
}
const trash = {
  id: 'threadbox:trash', name: 'Trash', kind: 'threadbox' as const, systemKind: 'trash' as const,
  readOnly: true, roots: [], codexProjectId: null, canCreateThread: false,
  createThreadUnavailableReason: '', createdAt: 1, updatedAt: 2
}
const result = { succeeded: ['ordinary'], failed: [], skipped: [], cascadedCount: 0, refreshedAt: 1 }
const environment = {
  state: 'ready', cliVersion: '0.153.4', cliPath: '/codex', minimumVersion: '0.153.3',
  capabilities: { pinning: false }, externalCodexProcesses: 0, message: null
}
function setup() {
  const api = {
    trashThreads: vi.fn(async () => result),
    listThreads: vi.fn(async () => ({
      threads: [thread], environment, inventory: { state: 'complete', message: null }, refreshedAt: 1
    })),
    listProjects: vi.fn(async () => ({ projects: [trash], assignments: {}, refreshedAt: 1 })),
    getEnvironmentStatus: vi.fn(async () => environment),
    assignThreads: vi.fn()
  }
  const sidebar = new ThreadboxSidebarProvider(api as unknown as ThreadboxApi, 'open', 'update', 'en')
  return { api, sidebar, item: new SidebarItem(thread.title, { kind: 'thread', thread }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  ui.trusted = true
  ui.warning.mockResolvedValue('Move to Trash')
  ui.info.mockImplementation(() => new Promise(() => {}))
})

describe('Sidebar Trash actions', () => {
  it('reloads immediately after moving, without waiting for the notification to close', async () => {
    const { api, sidebar, item } = setup()
    await sidebar.deleteThreads([item])
    expect(api.trashThreads).toHaveBeenCalledWith(['ordinary'])
    expect(api.listThreads).toHaveBeenCalledOnce()
    expect(ui.info).toHaveBeenCalledWith('1 succeeded, 0 failed, 0 skipped.')
    sidebar.dispose()
  })
  it('does not mutate when confirmation is cancelled', async () => {
    ui.warning.mockResolvedValueOnce(undefined)
    const { api, sidebar, item } = setup()
    await sidebar.deleteThreads([item])
    expect(api.trashThreads).not.toHaveBeenCalled()
    sidebar.dispose()
  })
  it('refreshes and explains failed drag-to-Trash operations', async () => {
    const { api, sidebar } = setup()
    await sidebar.getChildren()
    api.assignThreads.mockRejectedValueOnce(new ProjectAssignmentError({
      ...result, succeeded: [], skipped: [{ id: 'ordinary', message: 'Active threads cannot be deleted.' }]
    }))
    await sidebar.handleDrop(new SidebarItem('Trash', { kind: 'project', project: trash }), {
      get: () => ({ asString: async () => JSON.stringify(['ordinary']) })
    } as never)
    expect(api.listThreads).toHaveBeenCalledTimes(2)
    expect(ui.warning).toHaveBeenCalledWith(expect.stringContaining('ordinary: Active threads'))
    sidebar.dispose()
  })
  it('hides pin controls when the current CLI cannot support them', async () => {
    const { sidebar } = setup()
    const all: SidebarItem[] = []
    const visit = (items: SidebarItem[]): void => {
      for (const item of items) { all.push(item); visit(item.children ?? []) }
    }
    visit(await sidebar.getChildren())
    expect(all.find((item) => item.thread)?.contextValue).toBe('threadbox.thread.active.pinUnavailable')
    sidebar.dispose()
  })
  it('does not load tasks in an untrusted workspace', async () => {
    ui.trusted = false
    const { api, sidebar } = setup()
    await sidebar.getChildren()
    expect(api.getEnvironmentStatus).not.toHaveBeenCalled()
    expect(api.listThreads).not.toHaveBeenCalled()
    sidebar.dispose()
  })
})
