import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopApp from '../../src/renderer/src/DesktopApp'
import type { ListThreadsResult, ThreadboxApi, ThreadRecord } from '../../src/shared/contracts'
import '../../packages/ui/src/i18n'

afterEach(cleanup)
function task(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return { id, title: id, preview: '', cwd: '/work', projectId: null, createdAt: 0, updatedAt: 0,
    source: 'cli', archived: false, pinned: false, status: 'notLoaded', parentThreadId: null,
    descendantCount: 0, internal: false, ineligibleReason: null, ...overrides }
}
function mockApi(threads: ThreadRecord[]): ThreadboxApi {
  const snapshot: ListThreadsResult = { threads, environment: { state: 'ready', cliPath: '/codex', cliVersion: '0.149.0', minimumVersion: '0.149.0', message: null, externalCodexProcesses: 0, capabilities: { pinning: true } }, desktopRecents: { state: 'clean', staleCount: 0, staleEntries: [], message: null }, refreshedAt: 0 }
  const result = { succeeded: ['root'], failed: [], skipped: [], cascadedCount: 1, refreshedAt: 0 }
  return {
    getSettings: vi.fn().mockResolvedValue({ locale: 'en', customCliPath: null }),
    listThreads: vi.fn().mockResolvedValue(snapshot), getEnvironmentStatus: vi.fn().mockResolvedValue(snapshot.environment),
    getPlatformCapabilities: vi.fn(), deleteThreads: vi.fn().mockResolvedValue(result),
    archiveThreads: vi.fn().mockResolvedValue(result), unarchiveThreads: vi.fn().mockResolvedValue(result),
    setPinned: vi.fn().mockResolvedValue(result), repairDesktopRecents: vi.fn(), listProjects: vi.fn().mockResolvedValue({ projects: [], assignments: {}, refreshedAt: 0 }),
    createProject: vi.fn(), renameProject: vi.fn(), deleteProject: vi.fn(), assignThreads: vi.fn(),
    openWorkingDirectory: vi.fn(), copyThreadId: vi.fn(), chooseCliPath: vi.fn(), updateSettings: vi.fn()
  }
}
describe('desktop manager', () => {
  it('loads project metadata and searches real project names independently of directories', async () => {
    const api = mockApi([task('root'), task('unassigned')])
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [{ id: 'official:p', name: 'Product planning', kind: 'official', readOnly: true, createdAt: null, updatedAt: null }], assignments: { root: 'official:p' }, refreshedAt: 0 })
    render(<DesktopApp api={api} />)
    await screen.findByRole('button', { name: 'Product planning', exact: true })
    expect(api.listProjects).toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Product planning' } })
    expect(screen.getByRole('article', { name: 'root' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'unassigned' })).not.toBeInTheDocument()
  })
  it('shows project retrieval failure without hiding the task inventory', async () => {
    const api = mockApi([task('root')])
    vi.mocked(api.listProjects).mockRejectedValue(new Error('Project service disconnected'))
    render(<DesktopApp api={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Project service disconnected')
    expect(screen.getByRole('article', { name: 'root' })).toBeInTheDocument()
    expect(screen.queryByText('No projects')).not.toBeInTheDocument()
  })
  it('selects and archives only the main task, not its hidden agents', async () => {
    const api = mockApi([task('root', { descendantCount: 1 }), task('child', { internal: true, parentThreadId: 'root' })])
    render(<DesktopApp api={api} />)
    await screen.findByRole('article', { name: 'root' })
    expect(screen.queryByRole('article', { name: 'child' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task: root' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive', exact: true })[0])
    await waitFor(() => expect(api.archiveThreads).toHaveBeenCalledWith(['root']))
  })
  it('explains protected descendants and provides access to unlinked agents', async () => {
    const api = mockApi([task('root'), task('child', { internal: true, parentThreadId: 'root', status: 'active' }), task('orphan', { internal: true, parentThreadId: 'missing' })])
    render(<DesktopApp api={api} />)
    const root = await screen.findByRole('article', { name: 'root' })
    expect(within(root).getByRole('button', { name: 'A child task is running or pinned' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Unlinked agent tasks/ }))
    expect(screen.getByRole('article', { name: 'orphan' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'root' })).not.toBeInTheDocument()
  })
  it('keeps folders by default, confirms cascade and surfaces backend protection changes', async () => {
    const api = mockApi([task('root', { descendantCount: 1 }), task('child', { internal: true, parentThreadId: 'root' })])
    vi.mocked(api.deleteThreads).mockResolvedValue({ succeeded: [], failed: [], skipped: [{ id: 'root', message: 'A spawned descendant is active or pinned.' }], cascadedCount: 0, refreshedAt: 1 })
    render(<DesktopApp api={api} />)
    const root = await screen.findByRole('article', { name: 'root' })
    fireEvent.click(within(root).getByRole('button', { name: 'Delete tasks...' }))
    expect(screen.getByText('Includes 1 child task, deleted together with the parent.')).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Delete permanently' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this deletion is permanent.' }))
    fireEvent.click(confirm)
    await waitFor(() => expect(api.deleteThreads).toHaveBeenCalledWith(['root'], { trashWorkingDirectories: [] }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A spawned descendant is active or pinned.')
  })
  it('clears selection when navigating and reports refresh failure without losing tasks', async () => {
    const api = mockApi([task('root')])
    render(<DesktopApp api={api} />)
    await screen.findByRole('article', { name: 'root' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task: root' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } })
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    vi.mocked(api.listThreads).mockRejectedValueOnce(new Error('Disconnected'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disconnected')
    expect(screen.getByRole('article', { name: 'root' })).toBeInTheDocument()
  })
})
