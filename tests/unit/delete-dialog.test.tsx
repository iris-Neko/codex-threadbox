import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteDialog } from '../../packages/ui/src/components/DeleteDialog'
import '../../packages/ui/src/i18n'
import type { ThreadRecord } from '../../src/shared/contracts'

afterEach(cleanup)

function record(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    title: id,
    preview: id,
    cwd: '/workspace',
    projectId: null,
    createdAt: 100,
    updatedAt: 200,
    source: 'cli',
    archived: false,
    pinned: false,
    status: 'notLoaded',
    parentThreadId: null,
    descendantCount: 0,
    internal: false,
    ineligibleReason: null,
    ...overrides
  }
}

describe('DeleteDialog', () => {
  it('requires acknowledgement and excludes pinned or active tasks', () => {
    const confirm = vi.fn()
    render(
      <DeleteDialog
        threads={[
          record('eligible', { descendantCount: 2 }),
          record('pinned', { pinned: true, ineligibleReason: 'pinned' }),
          record('active', { status: 'active', ineligibleReason: 'active' })
        ]}
        externalProcesses={1}
        allowDirectoryTrash
        busy={false}
        onClose={() => undefined}
        onConfirm={confirm}
      />
    )

    const button = screen.getByRole('button', { name: 'Delete permanently' })
    expect(button).toBeDisabled()
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I understand this deletion is permanent.' })
    )
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith(['eligible'], [])
    expect(screen.getByText(/Other Codex processes are open/)).toBeInTheDocument()
  })

  it('lets each working directory be kept or moved to Trash independently', () => {
    const confirm = vi.fn()
    render(
      <DeleteDialog
        threads={[
          record('keep', { cwd: '/workspace/keep' }),
          record('trash', { cwd: '/workspace/trash' })
        ]}
        externalProcesses={0}
        allowDirectoryTrash
        busy={false}
        onClose={() => undefined}
        onConfirm={confirm}
      />
    )

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'I understand this deletion is permanent.' })
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '/workspace/trash' }))
    const destructiveButton = screen.getByRole('button', {
      name: 'Delete tasks and trash directories'
    })
    expect(destructiveButton).toBeDisabled()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /selected directories will be moved to Trash/
      })
    )
    fireEvent.click(destructiveButton)

    expect(confirm).toHaveBeenCalledWith(['keep', 'trash'], ['/workspace/trash'])
  })
})
