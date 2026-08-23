import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecentsRepairDialog } from '../../src/renderer/src/components/RecentsRepairDialog'
import '../../src/renderer/src/i18n'

afterEach(cleanup)

describe('RecentsRepairDialog', () => {
  it('shows exact stale entries and requires acknowledgement', () => {
    const confirm = vi.fn()
    render(
      <RecentsRepairDialog
        status={{
          state: 'stale',
          staleCount: 2,
          staleEntries: [
            { id: 'stale-one', title: 'Old sidebar task' },
            { id: 'stale-two', title: 'Another stale task' }
          ],
          message: null
        }}
        busy={false}
        onClose={() => undefined}
        onConfirm={confirm}
      />
    )

    expect(screen.getByText('Old sidebar task')).toBeInTheDocument()
    expect(screen.getByText('stale-one')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Repair index' })
    expect(button).toBeDisabled()

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: "I understand this repairs Codex desktop's local sidebar index."
      })
    )
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledOnce()
  })
})
