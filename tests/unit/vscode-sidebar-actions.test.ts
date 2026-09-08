// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchOperationResult, ThreadboxApi, ThreadRecord } from '../../src/shared/contracts'

const ui = vi.hoisted(() => ({
  warning: vi.fn(), info: vi.fn(), error: vi.fn(), input: vi.fn(), trusted: true,
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
  TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
  workspace: { get isTrusted() { return ui.trusted } },
  window: {
    showWarningMessage: ui.warning, showInformationMessage: ui.info, showErrorMessage: ui.error,
    showInputBox: ui.input,
    createOutputChannel: () => ({ appendLine: ui.appendLine, show: ui.showLog, dispose: ui.disposeLog })
  },
  commands: { executeCommand: ui.command }
}))

import { SidebarItem, ThreadboxSidebarProvider, type SidebarPreferences } from '../../packages/vscode/src/sidebar'
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
function setup(recover?: (ids: string[]) => Promise<BatchOperationResult | null>, records = [thread], preferences?: SidebarPreferences) {
  const api = {
    renameThread: vi.fn(async () => undefined),
    trashThreads: vi.fn<(ids: string[]) => Promise<BatchOperationResult>>().mockResolvedValue(result),
    restoreThreadsFromTrash: vi.fn(async () => result),
    archiveThreads: vi.fn(async () => result),
    unarchiveThreads: vi.fn(async () => result),
    emptyTrash: vi.fn(async () => result),
    listThreads: vi.fn(async () => ({
      threads: records, environment, inventory: { state: 'complete', message: null }, refreshedAt: 1
    })),
    listProjects: vi.fn(async () => ({ projects: [trash], assignments: {}, refreshedAt: 1 })),
    getEnvironmentStatus: vi.fn(async () => environment),
    assignThreads: vi.fn()
  }
  const sidebar = new ThreadboxSidebarProvider(api as unknown as ThreadboxApi, 'open', 'update', 'en', recover, preferences)
  return { api, sidebar, item: new SidebarItem(thread.title, { kind: 'thread', thread }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  ui.trusted = true
  ui.input.mockResolvedValue(undefined)
  ui.warning.mockResolvedValue('Move to Trash')
  ui.info.mockImplementation(() => new Promise(() => {}))
})

describe('Sidebar Trash actions', () => {
  it('re-archives restored tasks if a drag-to-project assignment fails', async () => {
    const { sidebar, api } = setup(undefined, [{ ...thread, archived: true }])
    await sidebar.getChildren()
    api.assignThreads.mockRejectedValueOnce(new Error('disk full'))
    ui.warning.mockResolvedValueOnce('Move to project')
    await sidebar.handleDrop(new SidebarItem('Unassigned', { kind: 'unassigned' }), {
      get: () => ({ asString: async () => JSON.stringify(['ordinary']) })
    } as never)
    expect(api.unarchiveThreads).toHaveBeenCalledExactlyOnceWith(['ordinary'])
    expect(api.archiveThreads).toHaveBeenCalledExactlyOnceWith(['ordinary'])
    expect(ui.error).toHaveBeenCalledWith('disk full')
    sidebar.dispose()
  })
  it('hides checkboxes until multiselect is enabled, and clears them when disabled', async () => {
    const { sidebar, api } = setup()
    const flat = (items: SidebarItem[]): SidebarItem[] => items.flatMap((i) => [i, ...flat(i.children ?? [])])
    expect(flat(await sidebar.getChildren()).find((i) => i.thread)?.checkboxState).toBeUndefined()
    sidebar.toggleMultiSelect()
    const item = flat(await sidebar.getChildren()).find((i) => i.thread)!
    sidebar.checkItems([[item, 1]])
    sidebar.toggleMultiSelect()
    await sidebar.deleteThreads([])
    expect(api.trashThreads).not.toHaveBeenCalled()
    expect(flat(await sidebar.getChildren()).find((i) => i.thread)?.checkboxState).toBeUndefined()
    sidebar.dispose()
  })
  it('right-clicking a checked item applies Trash to all checked tasks, but an unchecked item stays independent', async () => {
    const second = { ...thread, id: 'second' }, third = { ...thread, id: 'third' }
    const { sidebar, api } = setup(undefined, [thread, second, third])
    const flat = (items: SidebarItem[]): SidebarItem[] => items.flatMap((i) => [i, ...flat(i.children ?? [])])
    sidebar.toggleMultiSelect()
    const items = flat(await sidebar.getChildren()).filter((i) => i.thread)
    sidebar.checkItems(items.filter((i) => i.thread?.id !== 'third').map((i) => [i, 1]))
    await sidebar.deleteThreads([items.find((i) => i.thread?.id === 'third')!])
    expect(api.trashThreads).toHaveBeenLastCalledWith(['third'])
    await sidebar.getChildren()
    sidebar.checkItems(items.filter((i) => i.thread?.id !== 'third').map((i) => [i, 1]))
    await sidebar.deleteThreads([items.find((i) => i.thread?.id === 'ordinary')!])
    expect(new Set(api.trashThreads.mock.calls.at(-1)?.[0])).toEqual(new Set(['ordinary', 'second']))
    sidebar.dispose()
  })
  it('places archived tasks under a sibling Archive grouped by original directory, excluding Trash', async () => {
    const archived = { ...thread, id: 'old', archived: true }
    const trashed = { ...thread, id: 'bin', archived: true }
    const { sidebar, api } = setup(undefined, [thread, archived, trashed])
    api.listProjects.mockResolvedValue({ projects: [trash], assignments: { bin: trash.id }, refreshedAt: 1 })
    const sections = await sidebar.getChildren()
    const groups = sections.find((i) => i.kind === 'section')!.children!
    const archive = groups.find((i) => i.id === 'threadbox:project:archived')!
    const unassigned = groups.find((i) => i.kind === 'unassigned')!
    expect(archive.children?.[0]?.kind).toBe('directory')
    expect(archive.children?.[0]?.children?.map((i) => i.thread?.id)).toEqual(['old'])
    expect(unassigned.children?.[0]?.children?.map((i) => i.thread?.id)).toEqual(['ordinary'])
    sidebar.dispose()
  })
  it('archives multiple native-selected tasks when dropped onto Archive', async () => {
    const { sidebar, api } = setup(undefined, [thread, { ...thread, id: 'second' }])
    await sidebar.getChildren()
    ui.warning.mockResolvedValueOnce('Archive')
    await sidebar.handleDrop(new SidebarItem('Archived', { kind: 'archive' }), {
      get: () => ({ asString: async () => JSON.stringify(['ordinary', 'second']) })
    } as never)
    expect(api.archiveThreads).toHaveBeenCalledExactlyOnceWith(['ordinary', 'second'])
    sidebar.dispose()
  })
  it('restores archived tasks when dragged back to Unassigned', async () => {
    const { sidebar, api } = setup(undefined, [{ ...thread, archived: true }])
    await sidebar.getChildren()
    api.assignThreads.mockResolvedValue({ projects: [trash], assignments: {}, refreshedAt: 1 })
    ui.warning.mockResolvedValueOnce('Move to project')
    await sidebar.handleDrop(new SidebarItem('Unassigned', { kind: 'unassigned' }), {
      get: () => ({ asString: async () => JSON.stringify(['ordinary']) })
    } as never)
    expect(api.unarchiveThreads).toHaveBeenCalledExactlyOnceWith(['ordinary'])
    expect(api.assignThreads).toHaveBeenCalledWith(['ordinary'], null)
    sidebar.dispose()
  })
  it('does not bypass Trash restoration through a checked Unarchive action', async () => {
    const { api, sidebar, item } = setup()
    api.listProjects.mockResolvedValue({ projects: [trash], assignments: { ordinary: trash.id }, refreshedAt: 1 })
    await sidebar.archiveThreads([item], false)
    expect(ui.error).toHaveBeenCalledWith('Use Restore from Trash for tasks in Trash.')
    sidebar.dispose()
  })
  it('persists ordering and scope, clears filters without touching task data', async () => {
    const save = vi.fn(async () => undefined)
    const { api, sidebar } = setup(undefined, [thread], {
      load: () => ({ scope: 'workspace', archive: 'archived', sort: 'updated-asc' }),
      save, directories: () => ['/work/app']
    })
    const collect = (items: SidebarItem[]): SidebarItem[] => items.flatMap((item) => [item, ...collect(item.children ?? [])])
    expect(collect(await sidebar.getChildren()).some((item) => item.thread)).toBe(false)
    await sidebar.resetFilters()
    expect(save).toHaveBeenLastCalledWith({ scope: 'all', archive: 'all', sort: 'updated-asc' })
    expect(collect(await sidebar.getChildren()).some((item) => item.thread?.id === thread.id)).toBe(true)
    expect(api.trashThreads).not.toHaveBeenCalled()
    sidebar.dispose()
  })
  it('checkboxes select tasks and Clear Checked Tasks cancels the batch', async () => {
    const { api, sidebar } = setup()
    sidebar.toggleMultiSelect()
    const collect = (items: SidebarItem[]): SidebarItem[] => items.flatMap((item) => [item, ...collect(item.children ?? [])])
    const item = collect(await sidebar.getChildren()).find((item) => item.thread)!
    sidebar.checkItems([[item, 1]])
    expect(collect(await sidebar.getChildren()).find((item) => item.thread)?.checkboxState).toBe(1)
    sidebar.clearSelection()
    await sidebar.deleteThreads([])
    expect(api.trashThreads).not.toHaveBeenCalled()
    expect(collect(await sidebar.getChildren()).find((item) => item.thread)?.checkboxState).toBe(0)
    sidebar.dispose()
  })
  it('keeps checkbox context ancestors unselected under archive filters', async () => {
    const { sidebar } = setup(undefined, [thread, { ...thread, id: 'archived-child', archived: true,
      parentThreadId: thread.id, internal: true, source: 'subAgentThreadSpawn' }])
    await sidebar.setView({ archive: 'archived' })
    await sidebar.selectFiltered()
    const collect = (items: SidebarItem[]): SidebarItem[] => items.flatMap((item) => [item, ...collect(item.children ?? [])])
    const items = collect(await sidebar.getChildren())
    expect(items.find((item) => item.thread?.id === thread.id)?.checkboxState).toBeUndefined()
    expect(items.find((item) => item.thread?.id === 'archived-child')?.checkboxState).toBe(1)
    sidebar.dispose()
  })
  it('selects filtered matches only and clears selection when filters change', async () => {
    const records = [thread, { ...thread, id: 'archived', archived: true }, { ...thread, id: 'trashed', archived: true }]
    const { api, sidebar } = setup(undefined, records)
    api.listProjects.mockResolvedValue({ projects: [trash], assignments: { trashed: trash.id }, refreshedAt: 1 })
    await sidebar.setView({ archive: 'active' })
    await sidebar.selectFiltered()
    await sidebar.deleteThreads([])
    expect(api.trashThreads).toHaveBeenCalledExactlyOnceWith(['ordinary'])
    await sidebar.selectFiltered()
    await sidebar.setView({ archive: 'archived' })
    await sidebar.deleteThreads([])
    expect(api.trashThreads).toHaveBeenCalledOnce()
    sidebar.dispose()
  })
  it('includes hidden descendants in confirmation but not unrelated filtered roots', async () => {
    const records = [thread, { ...thread, id: 'child', parentThreadId: thread.id, archived: true, internal: true, source: 'subAgentThreadSpawn' }]
    const { api, sidebar } = setup(undefined, records)
    await sidebar.setView({ archive: 'active' })
    await sidebar.selectFiltered()
    await sidebar.deleteThreads([])
    expect(ui.warning.mock.calls[0]?.[1]).toMatchObject({ modal: true, detail: expect.stringContaining('1 descendant tasks') })
    expect(api.trashThreads).toHaveBeenCalledExactlyOnceWith(['ordinary'])
    sidebar.dispose()
  })
  it('does not change task state when trust is revoked during confirmation', async () => {
    const { api, sidebar, item } = setup()
    ui.warning.mockImplementationOnce(async () => { ui.trusted = false; return 'Move to Trash' })
    await sidebar.deleteThreads([item])
    expect(api.trashThreads).not.toHaveBeenCalled()
    expect(ui.error).toHaveBeenCalled()
    sidebar.dispose()
  })
  it('does not mutate using partial inventories', async () => {
    const { api, sidebar, item } = setup()
    api.listThreads.mockResolvedValue({ threads: [thread], environment, inventory: { state: 'partial', message: 'Missing page' }, refreshedAt: 1 } as never)
    await sidebar.deleteThreads([item])
    expect(api.trashThreads).not.toHaveBeenCalled()
    expect(ui.error).toHaveBeenCalledWith('Missing page')
    sidebar.dispose()
  })
  it('renames a task and reloads without waiting for the success notification', async () => {
    const { api, sidebar, item } = setup()
    ui.input.mockResolvedValue(' Renamed task ')
    await sidebar.renameThread(item)
    expect(api.renameThread).toHaveBeenCalledExactlyOnceWith('ordinary', 'Renamed task')
    expect(api.listThreads).toHaveBeenCalledOnce()
    sidebar.dispose()
  })
  it('does not rename on cancellation, unchanged input, or loss of workspace trust', async () => {
    const { api, sidebar, item } = setup()
    await sidebar.renameThread(item)
    ui.input.mockResolvedValueOnce(thread.title)
    await sidebar.renameThread(item)
    ui.input.mockImplementationOnce(() => { ui.trusted = false; return Promise.resolve('Changed') })
    await sidebar.renameThread(item)
    expect(api.renameThread).not.toHaveBeenCalled()
    sidebar.dispose()
  })
  it('never offers process recovery for Restore or permanent Empty Trash', async () => {
    const recover = vi.fn(async () => result)
    const { api, sidebar, item } = setup(recover)
    const failure = { ...result, succeeded: [], failed: [
      { id: thread.id, message: 'thread ordinary already has an active writer' }
    ] }
    api.restoreThreadsFromTrash.mockResolvedValue(failure)
    ui.warning.mockResolvedValueOnce('Restore from Trash').mockResolvedValueOnce(undefined)
    await sidebar.restoreThreads([item])
    expect(ui.warning.mock.calls.at(-1)).not.toContain('Release Writer and Retry')
    api.emptyTrash.mockResolvedValue(failure)
    ui.warning.mockResolvedValueOnce('Empty Trash').mockResolvedValueOnce(undefined)
    await sidebar.emptyTrash(new SidebarItem('Trash', { kind: 'project', project: trash }))
    expect(ui.warning.mock.calls.at(-1)).not.toContain('Release Writer and Retry')
    expect(recover).not.toHaveBeenCalled()
    sidebar.dispose()
  })
  it('offers recovery only through the trusted host callback for a failed Trash operation', async () => {
    const recover = vi.fn(async () => result)
    const { api, sidebar, item } = setup(recover)
    api.trashThreads.mockResolvedValueOnce({ ...result, succeeded: [], failed: [
      { id: thread.id, message: 'thread ordinary already has an active writer' }
    ] })
    ui.warning.mockResolvedValueOnce('Move to Trash').mockResolvedValueOnce('Release Writer and Retry')
    await sidebar.deleteThreads([item])
    await vi.waitFor(() => expect(recover).toHaveBeenCalledExactlyOnceWith(['ordinary']))
    expect(ui.warning.mock.calls[1]).toContain('Release Writer and Retry')
    sidebar.dispose()
  })

  it('does not expose recovery when the host has no supported recovery backend', async () => {
    const { api, sidebar, item } = setup()
    api.trashThreads.mockResolvedValueOnce({ ...result, succeeded: [], failed: [
      { id: thread.id, message: 'thread ordinary already has an active writer' }
    ] })
    await sidebar.deleteThreads([item])
    expect(ui.warning.mock.calls.at(-1)).not.toContain('Release Writer and Retry')
    sidebar.dispose()
  })
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
    expect(api.listThreads).toHaveBeenCalledTimes(2)
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
    expect(api.listThreads).toHaveBeenCalledTimes(3)
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
