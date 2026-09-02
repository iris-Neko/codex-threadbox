import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../packages/ui/src/App'
import '../../packages/ui/src/i18n'
import type {
  BatchOperationResult,
  EnvironmentStatus,
  ProjectSnapshot,
  ThreadboxApi
} from '../../src/shared/contracts'

afterEach(cleanup)

const outdated: EnvironmentStatus = {
  state: 'outdated',
  cliPath: 'codex',
  cliVersion: '0.149.1',
  minimumVersion: '0.150.0',
  message: 'Codex CLI 0.150.0 or newer is required.',
  externalCodexProcesses: 0,
  capabilities: { pinning: false }
}
const ready: EnvironmentStatus = {
  ...outdated,
  state: 'ready',
  cliVersion: '0.150.1',
  message: null,
  capabilities: { pinning: true }
}
const missing: EnvironmentStatus = {
  ...outdated,
  state: 'missing',
  cliPath: null,
  cliVersion: null,
  message: 'Codex CLI was not found.'
}
const projects: ProjectSnapshot = { projects: [], assignments: {}, refreshedAt: 1 }
const batch: BatchOperationResult = {
  succeeded: [], failed: [], skipped: [], cascadedCount: 0, refreshedAt: 1
}

function createApi(initial: EnvironmentStatus, canUpdate: boolean): {
  api: ThreadboxApi
  update: ReturnType<typeof vi.fn>
} {
  let environment = initial
  const update = vi.fn(async () => {
    environment = ready
    return ready
  })
  const api: ThreadboxApi = {
    getPlatformCapabilities: vi.fn(async () => ({
      host: 'vscode', projectManagement: true, desktopRecentsRepair: false,
      directoryTrash: false, chooseCliPath: false, openWorkingDirectory: true,
      currentWorkspaceDirectories: [], codexCliUpdate: canUpdate
    })),
    getEnvironmentStatus: vi.fn(async () => environment),
    updateCodexCli: canUpdate ? update : undefined,
    listThreads: vi.fn(async () => ({
      threads: [], environment, inventory: { state: 'complete', message: null },
      desktopRecents: { state: 'unavailable', staleCount: 0, staleEntries: [], message: null },
      refreshedAt: 1
    })),
    deleteThreads: vi.fn(async () => batch),
    repairDesktopRecents: vi.fn(async () => ({
      removed: 0, backupPath: null,
      status: { state: 'unavailable', staleCount: 0, staleEntries: [], message: null }
    })),
    archiveThreads: vi.fn(async () => batch),
    unarchiveThreads: vi.fn(async () => batch),
    setPinned: vi.fn(async () => batch),
    listProjects: vi.fn(async () => projects),
    createProject: vi.fn(async () => projects),
    renameProject: vi.fn(async () => projects),
    deleteProject: vi.fn(async () => projects),
    assignThreads: vi.fn(async () => projects),
    openWorkingDirectory: vi.fn(async () => null),
    copyThreadId: vi.fn(async () => undefined),
    chooseCliPath: vi.fn(async () => null),
    getSettings: vi.fn(async () => ({ locale: 'en', customCliPath: null })),
    updateSettings: vi.fn(async () => ({ locale: 'en', customCliPath: null }))
  }
  return { api, update }
}

describe('Manager Codex CLI update', () => {
  it('updates an outdated CLI and refreshes the manager', async () => {
    const { api, update } = createApi(outdated, true)
    render(<App api={api} version="0.9.0" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Update Codex CLI' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(await screen.findByText('Codex CLI updated to 0.150.1.')).toBeInTheDocument()
  })

  it('installs a missing CLI for the current user and refreshes the manager', async () => {
    const { api, update } = createApi(missing, true)
    render(<App api={api} version="0.9.0" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install Codex CLI' }))
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(await screen.findByText(
      'Codex CLI 0.150.1 installed for the current user.'
    )).toBeInTheDocument()
  })

  it('does not show the update action when the host cannot update Codex', async () => {
    const { api } = createApi(outdated, false)
    render(<App api={api} version="0.9.0" />)

    await screen.findByText('Codex CLI update required')
    expect(screen.queryByRole('button', { name: 'Update Codex CLI' })).not.toBeInTheDocument()
  })

  it('does not show the install action when the host cannot install Codex', async () => {
    const { api } = createApi(missing, false)
    render(<App api={api} version="0.9.0" />)

    await screen.findByText('Codex CLI is not ready')
    expect(screen.queryByRole('button', { name: 'Install Codex CLI' })).not.toBeInTheDocument()
  })

  it('does not show the update action when Codex already meets the minimum', async () => {
    const { api } = createApi(ready, true)
    render(<App api={api} version="0.9.0" />)

    await screen.findByText('Nothing here')
    expect(screen.queryByRole('button', { name: 'Update Codex CLI' })).not.toBeInTheDocument()
  })
})
