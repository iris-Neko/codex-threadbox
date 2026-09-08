// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchOperationResult, ThreadboxApi, ThreadRecord } from '../../src/shared/contracts'

const ui = vi.hoisted(() => ({
  warning: vi.fn(), info: vi.fn(), error: vi.fn(), trusted: true,
  appendLine: vi.fn(), showLog: vi.fn(), disposeLog: vi.fn(), command: vi.fn()
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
  window: {
    showWarningMessage: ui.warning, showInformationMessage: ui.info, showErrorMessage: ui.error,
    createOutputChannel: () => ({ appendLine: ui.appendLine, show: ui.showLog, dispose: ui.disposeLog })
  },
  commands: { executeCommand: ui.command }
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
const result: BatchOperationResult = { succeeded: ['ordinary'], failed: [], skipped: [], cascadedCount: 0, refreshedAt: 1 }
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
  it('opens the exact locked task through the existing Codex integration', async () => {
    const { api, sidebar, item } = setup()
    api.trashThreads.mockResolvedValueOnce({ ...result, succeeded: [], failed: [
      { id: thread.id, message: 'thread ordinary already has an active writer' }
    ] } as typeof result)
    ui.warning.mockResolvedValueOnce('Move to Trash').mockResolvedValueOnce('Open in Codex')
    await sidebar.deleteThreads([item])
    await vi.waitFor(() => expect(ui.command).toHaveBeenCalledWith('threadbox.openInCodex', thread.id))
    expect(ui.warning).toHaveBeenLastCalledWith(expect.stringContaining('still open in Codex'),
      'Open in Codex', 'View Details', 'Retry')
    expect(api.trashThreads).toHaveBeenCalledOnce()
    sidebar.dispose()
  })

  it('shows all error details even when a notification would be truncated', async () => {
    const { api, sidebar, item } = setup()
    const raw = 'thread ordinary already has an active writer'
    api.trashThreads.mockResolvedValueOnce({ ...result, succeeded: [], failed: [
      { id: thread.id, message: raw }
    ] } as typeof result)
    ui.warning.mockResolvedValueOnce('Move to Trash').mockResolvedValueOnce('View Details')
    await sidebar.deleteThreads([item])
    await vi.waitFor(() => expect(ui.showLog).toHaveBeenCalledWith(true))
    expect(ui.appendLine).toHaveBeenCalledWith(expect.stringContaining(raw))
    sidebar.dispose()
    expect(ui.disposeLog).toHaveBeenCalledOnce()
  })

  it('retries failed task IDs only, without replaying successful moves', async () => {
    const { api, sidebar, item } = setup()
    api.trashThreads.mockResolvedValueOnce({ ...result, failed: [
      { id: 'locked', message: 'thread locked already has an active writer' }
    ] } as typeof result)
    ui.warning.mockResolvedValueOnce('Move to Trash').mockResolvedValueOnce('Retry')
    await sidebar.deleteThreads([item])
    await vi.waitFor(() => expect(api.trashThreads).toHaveBeenLastCalledWith(['locked']))
    expect(api.trashThreads).toHaveBeenCalledTimes(2)
    sidebar.dispose()
  })

  it('does not retry after workspace trust has been revoked', async () => {
    const { api, sidebar, item } = setup()
    api.trashThreads.mockResolvedValueOnce({ ...result, succeeded: [], failed: [
      { id: 'locked', message: 'thread locked already has an active writer' }
    ] } as typeof result)
    ui.warning.mockResolvedValueOnce('Move to Trash').mockImplementationOnce(() => {
      ui.trusted = false
      return Promise.resolve('Retry')
    })
    await sidebar.deleteThreads([item])
    await vi.waitFor(() => expect(ui.error).toHaveBeenCalled())
    expect(api.trashThreads).toHaveBeenCalledOnce()
    sidebar.dispose()
  })
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
    expect(ui.warning).toHaveBeenCalledWith(expect.stringContaining('Ordinary task: Active threads'), 'View Details')
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
