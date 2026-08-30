import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../packages/ui/src/App'
import '../../packages/ui/src/i18n'
import type {
  BatchOperationResult,
  EnvironmentStatus,
  ProjectSnapshot,
  ThreadboxApi,
  ThreadRecord
} from '../../src/shared/contracts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const environment: EnvironmentStatus = {
  state: 'ready',
  cliPath: 'codex',
  cliVersion: '0.150.1',
  minimumVersion: '0.150.0',
  message: null,
  externalCodexProcesses: 0,
  capabilities: { pinning: false }
}

const projects: ProjectSnapshot = { projects: [], assignments: {}, refreshedAt: 1 }
const batch: BatchOperationResult = {
  succeeded: [], failed: [], skipped: [], cascadedCount: 0, refreshedAt: 1
}

function createApi(workspaceProjectImport: boolean, threads: ThreadRecord[] = []): {
  api: ThreadboxApi
  importWorkspace: ReturnType<typeof vi.fn>
  trash: ReturnType<typeof vi.fn>
} {
  const importWorkspace = vi.fn(async () => projects)
  const trash = vi.fn(async () => batch)
  const api: ThreadboxApi = {
    getPlatformCapabilities: vi.fn(async () => ({
      host: 'vscode',
      projectManagement: true,
      desktopRecentsRepair: false,
      directoryTrash: false,
      chooseCliPath: false,
      openWorkingDirectory: true,
      currentWorkspaceDirectories: workspaceProjectImport ? ['/work/app'] : [],
      projectThreadCreation: true,
      taskTrash: true,
      workspaceProjectImport
    })),
    getEnvironmentStatus: vi.fn(async () => environment),
    listThreads: vi.fn(async () => ({
      threads,
      environment,
      inventory: { state: 'complete', message: null },
      desktopRecents: { state: 'clean', staleCount: 0, staleEntries: [], message: null },
      refreshedAt: 1
    })),
    deleteThreads: vi.fn(async () => batch),
    trashThreads: trash,
    archiveThreads: vi.fn(async () => batch),
    unarchiveThreads: vi.fn(async () => batch),
    setPinned: vi.fn(async () => batch),
    repairDesktopRecents: vi.fn(async () => ({
      removed: 0,
      backupPath: null,
      status: { state: 'clean', staleCount: 0, staleEntries: [], message: null }
    })),
    listProjects: vi.fn(async () => projects),
    createProject: vi.fn(async () => projects),
    importCurrentWorkspaceProject: importWorkspace,
    renameProject: vi.fn(async () => projects),
    deleteProject: vi.fn(async () => projects),
    assignThreads: vi.fn(async () => projects),
    openWorkingDirectory: vi.fn(async () => null),
    copyThreadId: vi.fn(async () => undefined),
    chooseCliPath: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({ locale: 'en', customCliPath: null })),
    updateSettings: vi.fn(async () => ({ locale: 'en', customCliPath: null }))
  }
  return { api, importWorkspace, trash }
}

describe('Manager workspace import', () => {
  it('shows the workspace import action and invokes the host API', async () => {
    const { api, importWorkspace } = createApi(true)
    render(<App api={api} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Import workspace' }))
    await waitFor(() => expect(importWorkspace).toHaveBeenCalledOnce())
  })

  it('hides workspace import when no workspace is open', async () => {
    const { api } = createApi(false)
    render(<App api={api} />)

    await screen.findByRole('button', { name: 'New project' })
    expect(screen.queryByRole('button', { name: 'Import workspace' })).not.toBeInTheDocument()
  })
})

describe('Manager task Trash', () => {
  it('revalidates stale active status in the host instead of blocking deletion in the UI', async () => {
    const staleActive: ThreadRecord = {
      id: 'stale-active', title: 'Stale Windows task', preview: '', cwd: 'C:\\work',
      projectId: null, createdAt: 1, updatedAt: 2, source: 'vscode', archived: false,
      pinned: false, status: 'active', parentThreadId: null, descendantCount: 0,
      internal: false, ineligibleReason: 'active'
    }
    const { api, trash } = createApi(false, [staleActive])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App api={api} />)

    expect(await screen.findByRole('button', { name: 'Move to Trash' })).toBeEnabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task: Stale Windows task' }))
    const toolbarAction = screen.getAllByRole('button', { name: 'Move to Trash' })
      .find((button) => button.textContent?.includes('Move to Trash'))
    expect(toolbarAction).toBeEnabled()
    fireEvent.click(toolbarAction!)

    await waitFor(() => expect(trash).toHaveBeenCalledWith(['stale-active']))
  })
})
