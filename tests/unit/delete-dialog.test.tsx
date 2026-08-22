import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeleteDialog } from '../../src/renderer/src/components/DeleteDialog'
import '../../src/renderer/src/i18n'
import type { ThreadRecord } from '../../src/shared/contracts'

function record(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    title: id,
    preview: id,
    cwd: '/workspace',
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
        busy={false}
        onClose={() => undefined}
        onConfirm={confirm}
      />
    )

    const button = screen.getByRole('button', { name: 'Delete permanently' })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith(['eligible'])
    expect(screen.getByText(/Other Codex processes are open/)).toBeInTheDocument()
  })
})
