import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RenameThreadDialog } from '../../packages/ui/src/components/RenameThreadDialog'
import '../../packages/ui/src/i18n'

afterEach(cleanup)
it('requires a changed valid name and does not submit when cancelled', () => {
  const submit = vi.fn(async () => undefined)
  const close = vi.fn()
  render(<RenameThreadDialog initialName="Old" busy={false} onClose={close} onSubmit={submit} />)
  const field = screen.getByRole('textbox', { name: 'Task name' })
  expect(field).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
  fireEvent.change(field, { target: { value: ' ' } })
  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(close).toHaveBeenCalledOnce()
  expect(submit).not.toHaveBeenCalled()
})
